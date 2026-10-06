// @ts-check
/**
 * Claude PR pipeline state machine (.github/workflows/claude-pr.yml). Reads an opted-in PR's
 * current state and picks the one next step. It is level-triggered: every event re-derives the
 * step from scratch, so a lost or out-of-order event costs a delay, never a wrong merge.
 * Branch protection is unavailable on the organisation's GitHub plan, so this script is the merge
 * gate. The same script runs in Centcom and Centcom-backend; claude-pr.config.json holds the
 * differences.
 *
 * Usage:
 *   node tools/ci/claude-pr-state.mjs <pr>           plan: write the next step to $GITHUB_OUTPUT
 *   node tools/ci/claude-pr-state.mjs <pr> --merge   in the merge lock: re-plan, squash-merge if
 *                                                    ready, then record the lanes on main
 *   node tools/ci/claude-pr-state.mjs <pr> --record  after a Claude run: set claude-review, hand
 *                                                    off, or re-plan (never trusts PR code)
 * Env: GH_TOKEN, GH_REPO, CLAUDE_AUTOMERGE (`off` pauses), HAS_CLAUDE_TOKEN (plan), and for
 * --record: ACTION, PLANNED, REVIEW, LOCAL, VERDICT, SUMMARY, CLAUDE_OUTCOME.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOKKEEPING, STATUS, gitIn, markMerged, regenerate } from './claude-pr-bookkeeping.mjs';

/**
 * @typedef {{
 *   lanePattern: string, laneCardDir: string, requiredChecks: string[],
 *   titleCheck: string | null, protectedPaths: string[], protectedNames: string[],
 *   laneOwnedPaths: string[], gates: string, execTools: string[], mainWorkflows: string[],
 * }} Config
 */

/** @type {Config} */
export const CONFIG = JSON.parse(
  readFileSync(join(import.meta.dirname, 'claude-pr.config.json'), 'utf8'),
);
/** The required checks, as `<workflow> / <job>`. */
export const REQUIRED_CHECKS = CONFIG.requiredChecks;

export const OPT_IN_LABEL = 'claude-automerge';
export const HANDOFF_LABEL = 'claude-needs-human';
export const BLOCKING_LABELS = [HANDOFF_LABEL, 'do-not-merge'];
export const CLAUDE_STATUS = 'claude-review';
/** Only statuses this pipeline posted (with GITHUB_TOKEN) count as Claude's verdict. */
export const STATUS_CREATOR = 'github-actions[bot]';
/** Labelled PRs a re-plan can act on (the sweep and the post-merge fan-out). */
export const ACTIONABLE_SEARCH = 'draft:false -label:claude-needs-human -label:do-not-merge';

/** Review fixes, CI fixes and conflict resolutions together; then a human takes over. */
export const MAX_FIX_ROUNDS = 3;
/** Claude's fix commits end with this marker (see claude-prompts/). Merges of main do not. */
const FIX_COMMIT = / \(claude\)$/;

/** Tools every Claude run gets: read, edit, commit, push to the PR branch, comment, read CI logs. */
export const BASE_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'Edit',
  'Write',
  'Bash(git status)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git add:*)',
  'Bash(git commit:*)',
  'Bash(git push origin HEAD)',
  'Bash(gh pr view:*)',
  'Bash(gh pr diff:*)',
  'Bash(gh pr comment:*)',
  'Bash(gh run view:*)',
];
/** Extra tools for finishing a merge of main. */
export const UPDATE_TOOLS = [
  'Bash(git merge --abort)',
  'Bash(git checkout --ours:*)',
  'Bash(git checkout --theirs:*)',
  'Bash(git checkout origin/main -- pnpm-lock.yaml)',
  'Bash(pnpm install --lockfile-only)',
  'Bash(python3 tools/plan/progress.py)',
];

/**
 * @typedef {{ path: string, status: string }} ChangedFile
 */

/**
 * Protected paths are never auto-merged: the config's directories and files, Claude's own
 * configuration anywhere in the tree, and the lane-owned files unless merely modified.
 * @param {string} path
 * @param {string} [status] the files API status: modified, added, removed, renamed, ...
 */
export function isProtected(path, status = 'modified') {
  if (CONFIG.laneOwnedPaths.includes(path) && status === 'modified') return false;
  const segments = path.split('/');
  return (
    CONFIG.protectedPaths.some((p) => path === p || path.startsWith(p)) ||
    CONFIG.protectedNames.includes(segments.at(-1) ?? '') ||
    segments.slice(0, -1).includes('.claude')
  );
}

/**
 * Lane IDs from a PR title: `B037: x` gives [B037]; `C071+C073: x` gives [C071, C073].
 * @param {string} title
 */
export function laneIds(title) {
  const lane = CONFIG.lanePattern;
  const prefix = new RegExp(`^(${lane}(?:\\+${lane})*):`).exec(title)?.[1];
  return prefix ? prefix.split('+') : [];
}

/**
 * @typedef {{ __typename: 'CheckRun', name: string, workflowName: string, status: string,
 *   conclusion: string, startedAt: string, detailsUrl?: string }
 *   | { __typename: 'StatusContext', context: string, state: string }} Check
 * @typedef {{ author: { login: string }, state: string }} Review
 * @typedef {{ messageHeadline: string, messageBody?: string }} Commit
 * @typedef {{
 *   number: number, state: string, isDraft: boolean, baseRefName: string,
 *   isCrossRepository: boolean, mergeable: string, headRefOid: string, headRefName: string,
 *   title: string, labels: { name: string }[], reviews: Review[], commits: Commit[],
 *   statusCheckRollup: Check[], changedFiles?: number, verifiedReview?: string,
 * }} PullRequest
 * @typedef {'skip' | 'wait' | 'review' | 'fix-ci' | 'update' | 'needs-human' | 'merge'} Action
 * @typedef {{ action: Action, reason: string, failed?: string[], allowFixes?: boolean }} Step
 */
const FIELDS =
  'number,state,isDraft,baseRefName,isCrossRepository,mergeable,headRefOid,headRefName,title,labels,reviews,commits,statusCheckRollup,changedFiles';

/**
 * Logins whose standing review is "changes requested". A COMMENTED review (every reply to a review
 * thread is one) does not withdraw a change request; only an approval or a dismissal does.
 * @param {Review[]} reviews oldest first, as gh returns them
 */
export function changesRequestedBy(reviews) {
  /** @type {Map<string, string>} */
  const latest = new Map();
  for (const r of reviews) {
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) {
      latest.set(r.author.login, r.state);
    }
  }
  return [...latest].filter(([, state]) => state === 'CHANGES_REQUESTED').map(([login]) => login);
}

/**
 * A commit's full subject. GitHub cuts long headlines at about 70 characters with '…' and starts
 * messageBody with '…' and the rest of the subject.
 * @param {Commit} c
 */
export const subject = (c) =>
  c.messageHeadline.endsWith('…') && (c.messageBody ?? '').startsWith('…')
    ? c.messageHeadline.slice(0, -1) + ((c.messageBody ?? '').slice(1).split('\n')[0] ?? '')
    : c.messageHeadline;

/** @param {PullRequest} pr */
export const fixRounds = (pr) => pr.commits.filter((c) => FIX_COMMIT.test(subject(c))).length;

/**
 * The most recent run of one required check on the head SHA.
 * @param {PullRequest} pr
 * @param {string} name
 */
function latestRun(pr, name) {
  return pr.statusCheckRollup
    .filter((c) => c.__typename === 'CheckRun')
    .filter((c) => `${c.workflowName} / ${c.name}` === name)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .at(-1);
}

/**
 * @param {PullRequest} pr
 * @param {string} name
 * @returns {'missing' | 'pending' | 'success' | 'failed'}
 */
export function checkState(pr, name) {
  const last = latestRun(pr, name);
  if (!last) return 'missing';
  if (last.status !== 'COMPLETED') return 'pending';
  return last.conclusion === 'SUCCESS' ? 'success' : 'failed';
}

/**
 * A failed check with the run and job ids Claude needs for `gh run view --job <id> --log-failed`.
 * @param {PullRequest} pr
 * @param {string} name
 */
export function describeFailure(pr, name) {
  const run = latestRun(pr, name);
  const url = run?.__typename === 'CheckRun' ? (run.detailsUrl ?? '') : '';
  const ids = /\/actions\/runs\/(\d+)\/job\/(\d+)/.exec(url);
  return ids ? `${name} (run ${ids[1]}, job ${ids[2]})` : name;
}

/**
 * Claude's verdict on the head SHA: SUCCESS, FAILURE, PENDING, ERROR, or missing. The plan and
 * merge paths set verifiedReview from the statuses API, counting only this pipeline's statuses;
 * the rollup (anyone's status) is only good enough for ranking the merge queue.
 * @param {PullRequest} pr
 */
export function reviewState(pr) {
  if (pr.verifiedReview) return pr.verifiedReview;
  const status = pr.statusCheckRollup.find(
    (c) => c.__typename === 'StatusContext' && c.context === CLAUDE_STATUS,
  );
  return status?.__typename === 'StatusContext' ? status.state : 'missing';
}

/**
 * The one next step for the pull request.
 * @param {PullRequest} pr
 * @param {ChangedFile[] | null} files every changed path, renames on both sides; null when the
 *   list could not be read completely
 * @param {number} behindBy commits on main that the head does not contain
 * @param {boolean} paused CLAUDE_AUTOMERGE is off
 * @param {number} [queueHead] the first PR in the merge queue (see `queueHead`); unset when
 *   not yet known, which lets any behind PR update
 * @returns {Step}
 */
export function nextStep(pr, files, behindBy, paused, queueHead) {
  /** @type {(action: Action, reason: string) => Step} */
  const step = (action, reason) => ({ action, reason });
  const labels = pr.labels.map((l) => l.name);
  if (paused) return step('skip', 'paused: CLAUDE_AUTOMERGE is off');
  if (pr.state !== 'OPEN') return step('skip', `PR is ${pr.state}`);
  if (pr.isDraft) return step('skip', 'draft');
  if (pr.isCrossRepository) return step('skip', 'opened from a fork');
  if (pr.baseRefName !== 'main') return step('skip', `base is ${pr.baseRefName}, not main`);
  if (!labels.includes(OPT_IN_LABEL)) return step('skip', `no ${OPT_IN_LABEL} label`);
  const blocking = labels.find((l) => BLOCKING_LABELS.includes(l));
  if (blocking) return step('skip', `labelled ${blocking}`);
  const requesters = changesRequestedBy(pr.reviews);
  if (requesters.length > 0) return step('skip', `${requesters.join(', ')} requested changes`);

  if (files === null) {
    return step('needs-human', 'could not list every changed file to check protected paths');
  }
  const touched = [
    ...new Set(files.filter((f) => isProtected(f.path, f.status)).map((f) => f.path)),
  ];
  if (touched.length > 0) {
    return step('needs-human', `touches protected paths: ${touched.join(', ')}`);
  }

  const rounds = fixRounds(pr);
  const canFix = rounds < MAX_FIX_ROUNDS;
  const outOfRounds = `out of Claude fix rounds (${rounds} used)`;
  // GitHub runs no pull_request workflows on a conflicting PR, so resolve conflicts first.
  if (pr.mergeable === 'CONFLICTING') {
    return canFix
      ? step('update', 'conflicts with main')
      : step('needs-human', `conflicts with main; ${outOfRounds}`);
  }

  const checks = REQUIRED_CHECKS.map((name) => ({ name, state: checkState(pr, name) }));
  if (checks.some((c) => c.name === CONFIG.titleCheck && c.state === 'failed')) {
    return step('needs-human', 'the title does not start with a lane ID');
  }
  const failed = checks.filter((c) => c.state === 'failed').map((c) => c.name);
  if (failed.length > 0) {
    if (!canFix) return step('needs-human', `${failed.join(', ')} failing; ${outOfRounds}`);
    return { action: 'fix-ci', reason: `failed: ${failed.join(', ')}`, failed };
  }

  const review = reviewState(pr);
  if (review === 'missing') {
    return { action: 'review', reason: 'head SHA not reviewed', allowFixes: canFix };
  }
  if (review === 'PENDING') return step('wait', 'review in progress');
  if (review !== 'SUCCESS') return step('needs-human', 'Claude did not approve the head SHA');

  const waiting = checks.filter((c) => c.state !== 'success').map((c) => c.name);
  if (waiting.length > 0) return step('wait', `waiting for ${waiting.join(', ')}`);
  if (behindBy > 0) {
    // Only the head of the queue catches up with main; updating every ready PR after each merge
    // would re-run CI on all of them, every time.
    if (queueHead !== undefined && queueHead !== pr.number) {
      return step('wait', `${behindBy} commits behind main; queued after #${queueHead}`);
    }
    return step('update', `${behindBy} commits behind main`);
  }
  if (pr.mergeable !== 'MERGEABLE') return step('wait', `mergeable is ${pr.mergeable}`);
  return step('merge', 'reviewed, green and up to date with main');
}

/**
 * Whether a PR holds a place in the merge queue: it would merge once up to date, or it is approved
 * and waiting for its checks (so a head keeps its place while its own update runs). Mergeability
 * other than CONFLICTING is ignored: right after a merge GitHub reports UNKNOWN for a while.
 * @param {PullRequest} pr
 */
export function inQueue(pr) {
  const settled = {
    ...pr,
    mergeable: pr.mergeable === 'CONFLICTING' ? 'CONFLICTING' : 'MERGEABLE',
  };
  const { action } = nextStep(settled, [], 0, false);
  return action === 'merge' || (action === 'wait' && reviewState(settled) === 'SUCCESS');
}

/**
 * The merge queue's head: the lowest-numbered PR in the queue.
 * @param {PullRequest[]} prs
 * @returns {number | undefined}
 */
export function queueHead(prs) {
  const queued = prs.filter(inQueue).map((p) => p.number);
  return queued.length > 0 ? Math.min(...queued) : undefined;
}

/**
 * Fills `{{KEY}}` placeholders.
 * @param {string} template
 * @param {Record<string, string>} vars
 */
export const renderPrompt = (template, vars) =>
  template.replace(/\{\{(\w+)\}\}/g, (whole, key) => vars[key] ?? whole);

/**
 * Claude's tool allow-list for a step. Reviews run no code from the PR, so a review verdict cannot
 * be forged by the code under review; fix and conflict steps may run the gates but never approve.
 * @param {Action} action
 * @param {boolean} conflicting
 */
export function toolsFor(action, conflicting) {
  if (action === 'review') return BASE_TOOLS;
  if (action === 'fix-ci') return [...BASE_TOOLS, ...CONFIG.execTools];
  return [...BASE_TOOLS, ...UPDATE_TOOLS, ...(conflicting ? CONFIG.execTools : [])];
}

/**
 * @typedef {{ state: 'success' | 'failure', description: string }} StatusUpdate
 * @typedef {{ status?: StatusUpdate, handoff?: string, replan?: boolean, note: string }} Outcome
 */

/**
 * What a finished Claude run means. Inputs from the claude job (local, verdict, outcome) only ever
 * lead to a handoff or to nothing, except a review approval, and reviews run no PR code.
 * @param {{ action: string, planned: string, remote: string, local: string, verdict: string,
 *   summary: string, claudeOutcome: string, carriedOver: boolean }} r
 * @returns {Outcome}
 */
export function recordOutcome(r) {
  if (r.remote !== r.planned) {
    if (r.carriedOver) {
      return {
        status: {
          state: 'success',
          description: `Carried over from ${r.planned.slice(0, 7)}: merge of main`,
        },
        note: 'a clean merge of main keeps the approval',
      };
    }
    return {
      note:
        r.remote === r.local
          ? 'Claude pushed; the next run reviews the new head'
          : `the PR moved to ${r.remote.slice(0, 7)}; the next run re-plans`,
    };
  }
  if (r.local && r.local !== r.planned) {
    return {
      handoff: `Claude's commit ${r.local.slice(0, 7)} never reached the PR (push rejected, or the run ended first).`,
      note: 'commit not pushed',
    };
  }
  if (r.claudeOutcome !== 'success') {
    return {
      handoff: `The Claude step did not finish (${r.claudeOutcome || 'not run'}); see the workflow run.`,
      note: 'Claude step failed',
    };
  }
  if (r.action === 'review' && r.verdict === 'approve') {
    return {
      status: { state: 'success', description: 'Claude approved this SHA' },
      replan: true,
      note: 'approved',
    };
  }
  if (r.action === 'review' && r.verdict === 'needs_human') {
    return {
      status: { state: 'failure', description: 'Claude found a blocking issue it could not fix' },
      handoff: r.summary || 'Claude found a blocking issue it could not fix.',
      note: 'review rejected',
    };
  }
  return {
    handoff: r.summary || `Claude answered "${r.verdict || 'nothing'}" without pushing.`,
    note: 'nothing pushed',
  };
}

const NOT_BOOKKEEPING = BOOKKEEPING.map((f) => `:(exclude)${f}`);

/**
 * Whether `head` is `planned` plus a merge of main and nothing else: its parents are planned and a
 * commit on main, and its changes against main equal planned's changes against their merge base
 * (by patch-id, ignoring the generated progress files). Content-based, so it trusts no job output.
 * @param {{ planned: string, head: string, main: string, git: (...args: string[]) => string }} p
 */
export function isMergeOfMain({ planned, head, main, git }) {
  const [, first, second, ...rest] = git('rev-list', '--parents', '-n', '1', head).split(' ');
  if (first !== planned || !second || rest.length > 0) return false;
  try {
    git('merge-base', '--is-ancestor', second, main);
  } catch {
    return false;
  }
  /** @param {string} from @param {string} to */
  const patchId = (from, to) => {
    const diff = git('diff', '-U0', from, to, '--', '.', ...NOT_BOOKKEEPING);
    if (!diff) return '';
    const id = execFileSync('git', ['patch-id', '--stable'], {
      input: `${diff}\n`,
      encoding: 'utf8',
    });
    return id.split(' ')[0] ?? '';
  };
  return patchId(git('merge-base', planned, second), planned) === patchId(second, head);
}

/** @param {string[]} args */
const gh = (args) =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

/** @param {string} number @returns {PullRequest} */
const viewPr = (number) => JSON.parse(gh(['pr', 'view', number, '--json', FIELDS]));

/**
 * Every changed file, with both paths of a rename; null if the files API listed fewer files than
 * the PR has (it stops at 3000).
 * @param {string} number
 * @param {number} expected
 * @returns {ChangedFile[] | null}
 */
function changedFiles(number, expected) {
  /** @type {{ filename: string, status: string, previous_filename?: string }[]} */
  const rows = JSON.parse(
    gh(['api', '--paginate', '--slurp', `repos/{owner}/{repo}/pulls/${number}/files?per_page=100`]),
  ).flat();
  if (rows.length >= 3000 || rows.length !== expected) return null;
  return rows.flatMap((r) => [
    { path: r.filename, status: r.status },
    ...(r.previous_filename ? [{ path: r.previous_filename, status: 'renamed' }] : []),
  ]);
}

/**
 * This pipeline's newest claude-review status on a commit, upper-cased; 'missing' if none.
 * @param {string} sha
 */
function verifiedReview(sha) {
  /** @type {{ context: string, state: string, creator: { login: string } | null }[]} */
  const statuses = JSON.parse(
    gh(['api', `repos/{owner}/{repo}/commits/${sha}/statuses?per_page=100`]),
  );
  const ours = statuses.find(
    (s) => s.context === CLAUDE_STATUS && s.creator?.login === STATUS_CREATOR,
  );
  return ours ? ours.state.toUpperCase() : 'missing';
}

/** Opted-in PRs a re-plan can act on, lowest number first. */
const actionablePrs = () =>
  gh([
    'pr',
    'list',
    '--label',
    OPT_IN_LABEL,
    '--search',
    ACTIONABLE_SEARCH,
    '--limit',
    '1000',
    '--json',
    'number',
    '--jq',
    '.[].number',
  ])
    .split('\n')
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);

/** @param {string | number} pr */
const replan = (pr) => gh(['workflow', 'run', 'claude-pr.yml', '-f', `pr=${pr}`]);

/**
 * The plan for one PR, as the plan and merge jobs see it.
 * @param {string} number
 */
function plan(number) {
  const paused = process.env['CLAUDE_AUTOMERGE'] === 'off';
  const pr = viewPr(number);
  pr.verifiedReview = verifiedReview(pr.headRefOid);
  const files = changedFiles(number, pr.changedFiles ?? 0);
  const compare = `repos/{owner}/{repo}/compare/main...${pr.headRefOid}`;
  const behindBy = Number(gh(['api', compare, '--jq', '.behind_by']));
  let step = nextStep(pr, files, behindBy, paused);
  if (step.action === 'update' && pr.mergeable !== 'CONFLICTING') {
    /** @type {PullRequest[]} */
    const open = JSON.parse(
      gh(['pr', 'list', '--label', OPT_IN_LABEL, '--limit', '1000', '--json', FIELDS]),
    );
    const fresh = [...open.filter((p) => p.number !== pr.number), pr];
    step = nextStep(pr, files, behindBy, paused, queueHead(fresh));
  }
  return { pr, step };
}

/** @param {string} number @param {string} reason */
function handOff(number, reason) {
  // The comment goes first, so the reason is on the PR even if labelling fails.
  gh(['pr', 'comment', number, '--body', reason]);
  gh([
    'label',
    'create',
    HANDOFF_LABEL,
    '--force',
    '--color',
    'D93F0B',
    '--description',
    'Claude PR pipeline handed this PR to a human',
  ]);
  gh(['pr', 'edit', number, '--add-label', HANDOFF_LABEL]);
}

/**
 * Records merged lanes in plan/STATUS.json on main and regenerates the progress files, so lane PRs
 * never touch them. Runs in the merge job's checkout of main.
 * @param {string[]} lanes
 * @param {string} number
 */
function recordMergedLanes(lanes, number) {
  if (lanes.length === 0 || !existsSync(STATUS)) return;
  const git = gitIn();
  for (let attempt = 1; attempt <= 3; attempt++) {
    git('fetch', '-q', 'origin', 'main');
    git('reset', '-q', '--hard', 'origin/main');
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(STATUS, markMerged(readFileSync(STATUS, 'utf8'), lanes, number, today));
    git('add', '--', STATUS);
    regenerate();
    if (git('diff', '--cached', '--name-only') === '') return;
    git(
      '-c',
      'user.name=github-actions[bot]',
      '-c',
      'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit',
      '-q',
      '-m',
      `Progress: ${lanes.join(', ')} merged in #${number}`,
    );
    try {
      git('push', '-q', 'origin', 'HEAD:main');
      return;
    } catch (error) {
      console.error(`push of the progress commit failed (attempt ${attempt}): ${error}`);
    }
  }
  console.error('::warning::could not record the merged lanes in plan/STATUS.json; do it by hand');
}

/** @param {Record<string, string>} outputs */
function writeOutputs(outputs) {
  const file = process.env['GITHUB_OUTPUT'];
  if (!file) return console.log(JSON.stringify(outputs, null, 2));
  for (const [key, value] of Object.entries(outputs)) {
    const eof = `EOF_${randomUUID()}`;
    appendFileSync(file, `${key}<<${eof}\n${value}\n${eof}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const number = process.argv[2] ?? '';
  const env = process.env;
  if (process.argv.includes('--record')) {
    const planned = env['PLANNED'] ?? '';
    const action = env['ACTION'] ?? '';
    const remote = viewPr(number).headRefOid;
    let carriedOver = false;
    if (action === 'update' && env['REVIEW'] === 'SUCCESS' && remote !== planned) {
      const git = gitIn();
      git('fetch', '-q', 'origin', 'main', remote);
      carriedOver = isMergeOfMain({ planned, head: remote, main: 'origin/main', git });
    }
    const outcome = recordOutcome({
      action,
      planned,
      remote,
      local: env['LOCAL'] ?? '',
      verdict: env['VERDICT'] ?? '',
      summary: env['SUMMARY'] ?? '',
      claudeOutcome: env['CLAUDE_OUTCOME'] ?? '',
      carriedOver,
    });
    console.log(`PR #${number} (${action}): ${outcome.note}`);
    if (outcome.status) {
      const run = `${env['GITHUB_SERVER_URL']}/${env['GITHUB_REPOSITORY']}/actions/runs/${env['GITHUB_RUN_ID']}`;
      gh([
        'api',
        `repos/{owner}/{repo}/statuses/${remote}`,
        '-f',
        `state=${outcome.status.state}`,
        '-f',
        `context=${CLAUDE_STATUS}`,
        '-f',
        `description=${outcome.status.description}`,
        '-f',
        `target_url=${run}`,
      ]);
    }
    if (outcome.handoff) {
      handOff(number, `Claude handed this PR to a human (step: ${action}). ${outcome.handoff}`);
    }
    // An approval is a status set with GITHUB_TOKEN, which starts no workflow: re-plan explicitly.
    if (outcome.replan) replan(number);
  } else if (process.argv.includes('--merge')) {
    const { pr, step } = plan(number);
    console.log(`PR #${number} at ${pr.headRefOid}: ${step.action} (${step.reason})`);
    if (step.action === 'merge') {
      // --match-head-commit refuses the merge if anything was pushed after the checks above.
      gh(['pr', 'merge', number, '--squash', '--match-head-commit', pr.headRefOid]);
      console.log(`Merged PR #${number}.`);
      recordMergedLanes(laneIds(pr.title), number);
      // A merge or push made with GITHUB_TOKEN starts no `push` workflows: run main's checks here.
      for (const workflow of CONFIG.mainWorkflows) {
        gh(['workflow', 'run', workflow, '--ref', 'main']);
      }
      // Main moved: re-plan the other actionable PRs now (the queue head updates; conflicting PRs
      // get no pull_request runs, so this is how they hear about it).
      for (const other of actionablePrs().filter((n) => String(n) !== number)) replan(other);
    } else if (step.action === 'update') {
      // Another PR merged between planning and the merge lock: re-plan this one (it is now behind).
      replan(number);
    }
  } else {
    let { pr, step } = plan(number);
    const claudeSteps = ['review', 'fix-ci', 'update'];
    if (claudeSteps.includes(step.action) && env['HAS_CLAUDE_TOKEN'] === 'false') {
      step = {
        action: 'needs-human',
        reason: 'the CLAUDE_CODE_OAUTH_TOKEN secret is not set (see Setup in the pipeline docs)',
      };
    }
    console.log(`PR #${number} at ${pr.headRefOid}: ${step.action} (${step.reason})`);
    const lanes = laneIds(pr.title);
    const promptFile = join(import.meta.dirname, 'claude-prompts', `${step.action}.md`);
    const prompt = claudeSteps.includes(step.action)
      ? renderPrompt(readFileSync(promptFile, 'utf8'), {
          REPO: env['GH_REPO'] ?? '',
          PR: number,
          LANE: lanes.join('+') || 'lane',
          LANE_CARDS: lanes.map((id) => `${CONFIG.laneCardDir}/${id}.json`).join(', ') || 'none',
          FAILED_CHECKS: (step.failed ?? []).map((name) => describeFailure(pr, name)).join('; '),
          FIXES: step.allowFixes === false ? 'not allowed' : 'allowed',
          GATES: CONFIG.gates,
          PROTECTED: [...CONFIG.protectedPaths, ...CONFIG.protectedNames].join(', '),
        })
      : '';
    writeOutputs({
      action: step.action,
      reason: step.reason,
      head: pr.headRefOid,
      head_ref: pr.headRefName,
      review: reviewState(pr),
      prompt,
      tools: toolsFor(step.action, pr.mergeable === 'CONFLICTING').join(','),
    });
  }
}
