// @ts-check
/**
 * Claude PR pipeline state machine (.github/workflows/claude-pr.yml). Reads an opted-in PR's
 * current state and picks the one next step. It is level-triggered: every event re-derives the
 * step from scratch, so a lost or out-of-order event costs a delay, never a wrong merge.
 * Branch protection is unavailable on the organisation's GitHub plan, so this script is the merge
 * gate.
 * The same script runs in Centcom and Centcom-backend; claude-pr.config.json holds the differences.
 *
 * Usage:
 *   node tools/ci/claude-pr-state.mjs <pr>           plan: write the step to $GITHUB_OUTPUT
 *   node tools/ci/claude-pr-state.mjs <pr> --merge   re-plan, and squash-merge if the step is merge
 * Env: GH_TOKEN, GH_REPO, CLAUDE_AUTOMERGE (`off` pauses the pipeline).
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{
 *   lanePattern: string, laneCardDir: string, requiredChecks: string[],
 *   titleCheck: string | null, protectedPaths: string[], laneOwnedPaths: string[],
 *   gates: string, mainWorkflows: string[],
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

/** Review fixes, CI fixes and conflict resolutions together; then a human takes over. */
export const MAX_FIX_ROUNDS = 3;
/** Claude's fix commits end with this marker (see claude-prompts/). Clean merges of main do not. */
const FIX_COMMIT = / \(claude\)$/;

/**
 * CODEOWNERS-protected paths are never auto-merged, except the lane-owned files inside them
 * (`plan/STATUS.json`: every lane PR updates it).
 * @param {string} file
 */
export const isProtected = (file) =>
  !CONFIG.laneOwnedPaths.includes(file) &&
  CONFIG.protectedPaths.some((p) => file === p || file.startsWith(p));

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
 *   conclusion: string, startedAt: string }
 *   | { __typename: 'StatusContext', context: string, state: string }} Check
 * @typedef {{ author: { login: string }, state: string }} Review
 * @typedef {{ messageHeadline: string }} Commit
 * @typedef {{
 *   number: number, state: string, isDraft: boolean, baseRefName: string,
 *   isCrossRepository: boolean, mergeable: string, headRefOid: string, headRefName: string,
 *   title: string, labels: { name: string }[], reviews: Review[], commits: Commit[],
 *   statusCheckRollup: Check[],
 * }} PullRequest
 * @typedef {'skip' | 'wait' | 'review' | 'fix-ci' | 'update' | 'needs-human' | 'merge'} Action
 * @typedef {{ action: Action, reason: string, failed?: string[], allowFixes?: boolean }} Step
 */
const FIELDS =
  'number,state,isDraft,baseRefName,isCrossRepository,mergeable,headRefOid,headRefName,title,labels,reviews,commits,statusCheckRollup';

/** @param {PullRequest} pr */
export const fixRounds = (pr) =>
  pr.commits.filter((c) => FIX_COMMIT.test(c.messageHeadline)).length;

/**
 * State of one required check on the head SHA, from its most recent run.
 * @param {PullRequest} pr
 * @param {string} name
 * @returns {'missing' | 'pending' | 'success' | 'failed'}
 */
export function checkState(pr, name) {
  const runs = pr.statusCheckRollup
    .filter((c) => c.__typename === 'CheckRun')
    .filter((c) => `${c.workflowName} / ${c.name}` === name)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const last = runs.at(-1);
  if (!last) return 'missing';
  if (last.status !== 'COMPLETED') return 'pending';
  return last.conclusion === 'SUCCESS' ? 'success' : 'failed';
}

/**
 * Claude's verdict on the head SHA: SUCCESS, FAILURE, PENDING, ERROR, or missing.
 * @param {PullRequest} pr
 */
export function reviewState(pr) {
  const status = pr.statusCheckRollup.find(
    (c) => c.__typename === 'StatusContext' && c.context === CLAUDE_STATUS,
  );
  return status?.__typename === 'StatusContext' ? status.state : 'missing';
}

/**
 * The one next step for the pull request.
 * @param {PullRequest} pr
 * @param {string[]} files changed paths
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
  const latest = new Map(pr.reviews.map((r) => [r.author.login, r.state]));
  if ([...latest.values()].includes('CHANGES_REQUESTED')) {
    return step('skip', 'a reviewer requested changes');
  }

  const touched = files.filter(isProtected);
  if (touched.length > 0) {
    return step('needs-human', `touches protected paths: ${touched.join(', ')}`);
  }

  const rounds = fixRounds(pr);
  const canFix = rounds < MAX_FIX_ROUNDS;
  const outOfRounds = `still failing after ${rounds} Claude fix rounds`;
  // GitHub runs no pull_request workflows on a conflicting PR, so resolve conflicts first.
  if (pr.mergeable === 'CONFLICTING') {
    return canFix ? step('update', 'conflicts with main') : step('needs-human', outOfRounds);
  }

  const checks = REQUIRED_CHECKS.map((name) => ({ name, state: checkState(pr, name) }));
  if (checks.some((c) => c.name === CONFIG.titleCheck && c.state === 'failed')) {
    return step('needs-human', 'the title does not start with a lane ID');
  }
  const failed = checks.filter((c) => c.state === 'failed').map((c) => c.name);
  if (failed.length > 0) {
    if (!canFix) return step('needs-human', `${failed.join(', ')} ${outOfRounds}`);
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
 * The merge queue's head: the lowest-numbered opted-in PR that would merge if it were up to date.
 * @param {PullRequest[]} prs
 * @returns {number | undefined}
 */
export function queueHead(prs) {
  const ready = prs.filter((p) => nextStep(p, [], 0, false).action === 'merge');
  return ready.length > 0 ? Math.min(...ready.map((p) => p.number)) : undefined;
}

/**
 * Fills `{{KEY}}` placeholders.
 * @param {string} template
 * @param {Record<string, string>} vars
 */
export const renderPrompt = (template, vars) =>
  template.replace(/\{\{(\w+)\}\}/g, (whole, key) => vars[key] ?? whole);

/** @param {string[]} args */
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const number = process.argv[2] ?? '';
  const merging = process.argv.includes('--merge');
  const paused = process.env['CLAUDE_AUTOMERGE'] === 'off';
  /** @type {PullRequest} */
  const pr = JSON.parse(gh(['pr', 'view', number, '--json', FIELDS]));
  const files = gh(['pr', 'diff', number, '--name-only']).split('\n').filter(Boolean);
  const compare = `repos/{owner}/{repo}/compare/main...${pr.headRefOid}`;
  const behindBy = Number(gh(['api', compare, '--jq', '.behind_by']));
  let step = nextStep(pr, files, behindBy, paused);
  if (step.action === 'update' && pr.mergeable !== 'CONFLICTING') {
    /** @type {PullRequest[]} */
    const open = JSON.parse(
      gh(['pr', 'list', '--label', OPT_IN_LABEL, '--limit', '100', '--json', FIELDS]),
    );
    step = nextStep(pr, files, behindBy, paused, queueHead(open));
  }
  console.log(`PR #${number} at ${pr.headRefOid}: ${step.action} (${step.reason})`);

  if (merging && step.action === 'merge') {
    // --match-head-commit refuses the merge if anything was pushed after the checks above.
    gh(['pr', 'merge', number, '--squash', '--match-head-commit', pr.headRefOid]);
    console.log(`Merged PR #${number}.`);
    // A merge made with GITHUB_TOKEN triggers no `push` workflows, so run main's checks here.
    for (const workflow of CONFIG.mainWorkflows) {
      gh(['workflow', 'run', workflow, '--ref', 'main']);
    }
    // Main moved: re-plan the other opted-in PRs now (the next in the queue updates), not at
    // the sweep.
    const open = gh([
      'pr',
      'list',
      '--label',
      OPT_IN_LABEL,
      '--json',
      'number',
      '--jq',
      '.[].number',
    ]);
    for (const other of open.split('\n').filter((n) => n && n !== number)) {
      gh(['workflow', 'run', 'claude-pr.yml', '-f', `pr=${other}`]);
    }
  } else if (merging && step.action === 'update') {
    // Another PR merged between planning and the merge lock: re-plan this one (it is now behind).
    gh(['workflow', 'run', 'claude-pr.yml', '-f', `pr=${number}`]);
  } else if (!merging) {
    const lanes = laneIds(pr.title);
    const promptFile = join(import.meta.dirname, 'claude-prompts', `${step.action}.md`);
    const prompt = ['review', 'fix-ci', 'update'].includes(step.action)
      ? renderPrompt(readFileSync(promptFile, 'utf8'), {
          REPO: process.env['GH_REPO'] ?? '',
          PR: number,
          LANE: lanes.join('+') || 'lane',
          LANE_CARDS: lanes.map((id) => `${CONFIG.laneCardDir}/${id}.json`).join(', ') || 'none',
          FAILED_CHECKS: (step.failed ?? []).join(', '),
          FIXES: step.allowFixes === false ? 'not allowed' : 'allowed',
          GATES: CONFIG.gates,
          PROTECTED: CONFIG.protectedPaths.join(', '),
        })
      : '';
    const outputs = {
      action: step.action,
      reason: step.reason,
      head: pr.headRefOid,
      head_ref: pr.headRefName,
      review: reviewState(pr),
      prompt,
    };
    const file = process.env['GITHUB_OUTPUT'];
    if (file) {
      for (const [key, value] of Object.entries(outputs)) {
        const eof = `EOF_${randomUUID()}`;
        appendFileSync(file, `${key}<<${eof}\n${value}\n${eof}\n`);
      }
    } else {
      console.log(JSON.stringify(outputs, null, 2));
    }
  }
}
