// @ts-check
/**
 * Claude PR pipeline state machine: one next step per PR state, merge only when everything holds.
 * Repository-agnostic: the same tests run in Centcom and Centcom-backend against each one's
 * claude-pr.config.json.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolve, writeStatus } from './claude-pr-bookkeeping.mjs';
import {
  BASE_TOOLS,
  CLAUDE_STATUS,
  CONFIG,
  MAX_FIX_ROUNDS,
  REQUIRED_CHECKS,
  changesRequestedBy,
  describeFailure,
  fixRounds,
  isMergeOfMain,
  isProtected,
  protectedList,
  laneIds,
  nextStep,
  queueHead,
  recordOutcome,
  renderPrompt,
  toolsFor,
} from './claude-pr-state.mjs';

/** @typedef {import('./claude-pr-state.mjs').PullRequest} PullRequest */
/** @typedef {import('./claude-pr-state.mjs').Check} Check */
/** @typedef {import('./claude-pr-state.mjs').ChangedFile} ChangedFile */

/** A lane ID in this repository's scheme (`B040` or `C040`). */
const LANE = `${CONFIG.lanePattern[0]}040`;
/** Any required check, standing in for "a check that fails". */
const CHECK = REQUIRED_CHECKS.find((n) => n !== CONFIG.titleCheck) ?? '';

/** @param {string} name @param {Partial<{ status: string, conclusion: string, startedAt: string, detailsUrl: string }>} [over] */
const run = (name, over = {}) => {
  const [workflowName = '', job = ''] = name.split(' / ');
  return /** @type {Check} */ ({
    __typename: 'CheckRun',
    workflowName,
    name: job,
    status: 'COMPLETED',
    conclusion: 'SUCCESS',
    startedAt: '2026-10-06T01:00:00Z',
    ...over,
  });
};
/** @param {string} state */
const claude = (state) =>
  /** @type {Check} */ ({ __typename: 'StatusContext', context: CLAUDE_STATUS, state });

/** @param {Partial<PullRequest>} [over] @returns {PullRequest} */
const pr = (over = {}) => ({
  number: 7,
  state: 'OPEN',
  isDraft: false,
  baseRefName: 'main',
  isCrossRepository: false,
  mergeable: 'MERGEABLE',
  headRefOid: 'a'.repeat(40),
  headRefName: 'lane/x040-thing',
  title: `${LANE}: thing`,
  labels: [{ name: 'claude-automerge' }],
  reviews: [],
  commits: [{ messageHeadline: `${LANE}: thing` }],
  statusCheckRollup: [...REQUIRED_CHECKS.map((n) => run(n)), claude('SUCCESS')],
  ...over,
});
/** @param {string} path @param {string} [status] @returns {ChangedFile} */
const file = (path, status = 'modified') => ({ path, status });
const files = [file('apps/relay/src/index.ts')];
/** @param {Partial<PullRequest>} over @param {number} [behind] */
const action = (over, behind = 0) => nextStep(pr(over), files, behind, false).action;

/** @param {number} n */
const fixCommits = (n) =>
  Array.from({ length: n }, (_, i) => ({ messageHeadline: `${LANE}: review fixes ${i} (claude)` }));

describe('nextStep', () => {
  it('merges a reviewed, green, up-to-date PR', () => {
    expect(nextStep(pr(), files, 0, false)).toEqual({
      action: 'merge',
      reason: 'reviewed, green and up to date with main',
    });
  });

  it.each([
    ['paused', pr(), true],
    ['closed', pr({ state: 'MERGED' }), false],
    ['draft', pr({ isDraft: true }), false],
    ['fork', pr({ isCrossRepository: true }), false],
    ['other base', pr({ baseRefName: 'dev' }), false],
    ['not opted in', pr({ labels: [] }), false],
    [
      'handed off',
      pr({ labels: [{ name: 'claude-automerge' }, { name: 'claude-needs-human' }] }),
      false,
    ],
    [
      'do-not-merge',
      pr({ labels: [{ name: 'claude-automerge' }, { name: 'do-not-merge' }] }),
      false,
    ],
    [
      'changes requested',
      pr({ reviews: [{ author: { login: 'AlexanderGese' }, state: 'CHANGES_REQUESTED' }] }),
      false,
    ],
  ])('skips when %s', (_, p, paused) => {
    expect(nextStep(p, files, 0, paused).action).toBe('skip');
  });

  it.each([
    'contracts/index.json',
    'plan/GUIDELINES.md',
    '.github/workflows/ci.yml',
    'pnpm-workspace.yaml',
    'CLAUDE.md',
    'packages/core/CLAUDE.md',
    '.claude/settings.json',
    'apps/api/.claude/settings.json',
    '.mcp.json',
    '.npmrc',
  ])('hands %s changes to a human', (path) =>
    expect(nextStep(pr(), [...files, file(path)], 0, false).action).toBe('needs-human'),
  );

  it('lets a lane PR add dependencies and modify plan/STATUS.json, but no other plan/ file', () => {
    const lane = [
      ...files,
      ...['pnpm-lock.yaml', 'plan/STATUS.json', 'README.md'].map((p) => file(p)),
    ];
    expect(nextStep(pr(), lane, 0, false).action).toBe('merge');
    expect(nextStep(pr(), [...lane, file('plan/STATUS.md')], 0, false).action).toBe('needs-human');
  });

  it('catches a rename out of a protected path and a removed lane-owned file', () => {
    const renamed = [file('docs/CODEOWNERS', 'renamed'), file('.github/CODEOWNERS', 'renamed')];
    expect(nextStep(pr(), renamed, 0, false).action).toBe('needs-human');
    expect(nextStep(pr(), [file('plan/STATUS.json', 'removed')], 0, false).action).toBe(
      'needs-human',
    );
  });

  it('hands off when the changed files could not all be listed', () => {
    expect(nextStep(pr(), null, 0, false).action).toBe('needs-human');
  });

  it('reviews a head SHA with no claude-review status, without waiting for CI', () => {
    const rollup = REQUIRED_CHECKS.map((n) => run(n, { status: 'IN_PROGRESS', conclusion: '' }));
    expect(nextStep(pr({ statusCheckRollup: rollup }), files, 0, false)).toEqual({
      action: 'review',
      reason: 'head SHA not reviewed',
      allowFixes: true,
    });
  });

  it('reviews without fixing once the fix rounds are spent', () => {
    const p = pr({ commits: fixCommits(MAX_FIX_ROUNDS), statusCheckRollup: [] });
    expect(nextStep(p, files, 0, false)).toMatchObject({ action: 'review', allowFixes: false });
  });

  it('fixes failed checks, then hands off when the rounds are spent', () => {
    const rollup = [
      ...REQUIRED_CHECKS.map((n) => run(n, n === CHECK ? { conclusion: 'FAILURE' } : {})),
      claude('SUCCESS'),
    ];
    expect(nextStep(pr({ statusCheckRollup: rollup }), files, 0, false)).toEqual({
      action: 'fix-ci',
      reason: `failed: ${CHECK}`,
      failed: [CHECK],
    });
    expect(action({ statusCheckRollup: rollup, commits: fixCommits(MAX_FIX_ROUNDS) })).toBe(
      'needs-human',
    );
  });

  it('judges a check by its latest run, so a green re-run clears an old failure', () => {
    const rollup = [
      ...REQUIRED_CHECKS.map((n) => run(n)),
      run(CHECK, { conclusion: 'FAILURE', startedAt: '2026-10-06T00:00:00Z' }),
      claude('SUCCESS'),
    ];
    expect(action({ statusCheckRollup: rollup })).toBe('merge');
  });

  it.skipIf(!CONFIG.titleCheck)('hands a bad title to a human instead of fixing it', () => {
    const rollup = [
      ...REQUIRED_CHECKS.map((n) =>
        run(n, n === CONFIG.titleCheck ? { conclusion: 'FAILURE' } : {}),
      ),
    ];
    expect(action({ statusCheckRollup: rollup })).toBe('needs-human');
  });

  it('a non-approving review hands off; a pending one waits', () => {
    const checks = REQUIRED_CHECKS.map((n) => run(n));
    expect(action({ statusCheckRollup: [...checks, claude('FAILURE')] })).toBe('needs-human');
    expect(action({ statusCheckRollup: [...checks, claude('PENDING')] })).toBe('wait');
  });

  it('trusts the verified review over the rollup, which anyone can write to', () => {
    expect(nextStep(pr({ verifiedReview: 'missing' }), files, 0, false).action).toBe('review');
  });

  it('waits for checks that are missing or running after an approval', () => {
    expect(action({ statusCheckRollup: [claude('SUCCESS')] })).toBe('wait');
  });

  it('updates from main when conflicting (first) or behind (last), and waits on UNKNOWN', () => {
    expect(action({ mergeable: 'CONFLICTING', statusCheckRollup: [] })).toBe('update');
    expect(action({ mergeable: 'CONFLICTING', commits: fixCommits(MAX_FIX_ROUNDS) })).toBe(
      'needs-human',
    );
    expect(action({}, 2)).toBe('update');
    expect(action({ mergeable: 'UNKNOWN' })).toBe('wait');
  });

  it('does not count merges of main as fix rounds', () => {
    const commits = [
      ...fixCommits(MAX_FIX_ROUNDS - 1),
      { messageHeadline: "Merge remote-tracking branch 'origin/main' into lane/x040-thing" },
    ];
    expect(action({ commits, mergeable: 'CONFLICTING' })).toBe('update');
  });
});

describe('changesRequestedBy', () => {
  /** @param {...[string, string]} pairs */
  const reviews = (...pairs) => pairs.map(([login, state]) => ({ author: { login }, state }));
  it('keeps a change request standing through later comments (thread replies)', () => {
    expect(changesRequestedBy(reviews(['a', 'CHANGES_REQUESTED'], ['a', 'COMMENTED']))).toEqual([
      'a',
    ]);
  });
  it('clears it with an approval or a dismissal', () => {
    expect(changesRequestedBy(reviews(['a', 'CHANGES_REQUESTED'], ['a', 'APPROVED']))).toEqual([]);
    expect(changesRequestedBy(reviews(['a', 'DISMISSED']))).toEqual([]);
  });
});

describe('fixRounds', () => {
  it('reads a subject GitHub cut short', () => {
    const long = {
      messageHeadline: `${LANE}: review fixes: guard the empty config and add a timeout te…`,
      messageBody: '…st (claude)\n\n- guard',
    };
    expect(fixRounds(pr({ commits: [long] }))).toBe(1);
  });
});

describe('merge queue', () => {
  it('lets only the lowest-numbered ready PR catch up with main; the rest wait their turn', () => {
    const open = [pr({ number: 9 }), pr({ number: 4 }), pr({ number: 2, statusCheckRollup: [] })];
    expect(queueHead(open)).toBe(4);
    expect(nextStep(pr({ number: 4 }), files, 3, false, 4).action).toBe('update');
    expect(nextStep(pr({ number: 9 }), files, 3, false, 4)).toEqual({
      action: 'wait',
      reason: '3 commits behind main; queued after #4',
    });
    expect(queueHead([pr({ statusCheckRollup: [] })])).toBeUndefined();
  });

  it('ignores the UNKNOWN mergeability GitHub reports right after a merge', () => {
    expect(queueHead([pr({ number: 4, mergeable: 'UNKNOWN' }), pr({ number: 9 })])).toBe(4);
  });

  it('keeps an approved head in the queue while its own update runs CI', () => {
    const updating = pr({
      number: 4,
      statusCheckRollup: [run(CHECK, { status: 'IN_PROGRESS', conclusion: '' }), claude('SUCCESS')],
    });
    expect(queueHead([updating, pr({ number: 9 })])).toBe(4);
  });

  it('never queues conflict resolution: a conflicting PR updates at once', () => {
    expect(nextStep(pr({ number: 9, mergeable: 'CONFLICTING' }), files, 3, false, 4).action).toBe(
      'update',
    );
  });
});

describe('protectedList', () => {
  it('tells Claude about the lane-owned exception, so it does not flag STATUS.json edits', () => {
    expect(protectedList()).toContain('plan/ (except plan/STATUS.json)');
    expect(protectedList()).toContain('CLAUDE.md');
  });
});

describe('isProtected', () => {
  it('allows modifying the lane-owned file but not renaming or removing it', () => {
    expect(isProtected('plan/STATUS.json')).toBe(false);
    expect(isProtected('plan/STATUS.json', 'removed')).toBe(true);
    expect(isProtected('plan/STATUS.json', 'renamed')).toBe(true);
  });
});

describe('laneIds', () => {
  it('reads one lane or several joined with +', () => {
    const L = CONFIG.lanePattern[0];
    expect(laneIds(`${L}037: thing`)).toEqual([`${L}037`]);
    expect(laneIds(`${L}071+${L}073: two lanes`)).toEqual([`${L}071`, `${L}073`]);
    expect(laneIds('Brand: icon')).toEqual([]);
  });
});

describe('describeFailure', () => {
  it('gives Claude the run and job ids from the check run', () => {
    const p = pr({
      statusCheckRollup: [
        run(CHECK, {
          conclusion: 'FAILURE',
          detailsUrl: 'https://github.com/o/r/actions/runs/123/job/456',
        }),
      ],
    });
    expect(describeFailure(p, CHECK)).toBe(`${CHECK} (run 123, job 456)`);
  });
});

describe('toolsFor', () => {
  it('runs no PR code in a review; the claude job adds the gates to an update itself', () => {
    expect(toolsFor('review')).toEqual(BASE_TOOLS);
    expect(toolsFor('fix-ci')).toEqual(expect.arrayContaining(CONFIG.execTools));
    expect(toolsFor('update')).not.toEqual(expect.arrayContaining(CONFIG.execTools));
  });
});

describe('recordOutcome', () => {
  const P = 'p'.repeat(40);
  const base = {
    action: 'review',
    planned: P,
    remote: P,
    local: P,
    verdict: 'approve',
    summary: '',
    claudeOutcome: 'success',
    carriedOver: false,
  };
  it('approves an unchanged head and re-plans', () => {
    expect(recordOutcome(base)).toMatchObject({ status: { state: 'success' }, replan: true });
  });
  it('carries an approval over only when the content check passed', () => {
    const moved = { ...base, action: 'update', remote: 'r'.repeat(40), local: 'r'.repeat(40) };
    expect(recordOutcome({ ...moved, carriedOver: true }).status?.state).toBe('success');
    expect(recordOutcome(moved).status).toBeUndefined();
    expect(recordOutcome(moved).handoff).toBeUndefined();
  });
  it('hands off a commit that never reached the PR', () => {
    expect(recordOutcome({ ...base, action: 'fix-ci', local: 'l'.repeat(40) }).handoff).toMatch(
      /never reached the PR/,
    );
  });
  it('hands off a failed or timed-out Claude step without touching claude-review', () => {
    const out = recordOutcome({ ...base, claudeOutcome: 'failure', verdict: '' });
    expect(out.handoff).toMatch(/did not finish \(failure\)/);
    expect(out.status).toBeUndefined();
  });
  it("quotes Claude's own error message when the step reported one", () => {
    const out = recordOutcome({
      ...base,
      claudeOutcome: 'failure',
      verdict: '',
      claudeError: 'Invalid API key · Please run /login',
    });
    expect(out.handoff).toBe(
      'The Claude step did not finish (failure): Invalid API key · Please run /login',
    );
  });
  it('marks claude-review failed only for a review that found a blocking issue', () => {
    expect(recordOutcome({ ...base, verdict: 'needs_human' }).status?.state).toBe('failure');
    const fix = recordOutcome({
      ...base,
      action: 'fix-ci',
      verdict: 'needs_human',
      summary: 'flaky',
    });
    expect(fix).toMatchObject({ handoff: 'flaky' });
    expect(fix.status).toBeUndefined();
  });
});

// Real git repositories: slow to set up on Windows runners and laptops.
describe('isMergeOfMain', { timeout: 60_000 }, () => {
  /** @type {string[]} */
  const dirs = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  /** @param {Record<string, { pct: number, note: string }>} lanes */
  const status = (lanes) => writeStatus({ updated: '2026-10-01', lanes, next: [] });
  /** @param {string} block @param {string} tail */
  const readme = (block, tail) =>
    `# T\n\n<!-- progress:start -->\n${block}\n<!-- progress:end -->\n\n${tail}\n`;

  /**
   * A repo where a lane branch and main both moved on from a common base. `lane` and `main` are
   * the files each side changes; returns the planned (lane) commit, checked out.
   * @param {Record<string, string>} lane
   * @param {Record<string, string>} main
   */
  const scenario = (lane, main) => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-pr-merge-'));
    dirs.push(dir);
    /** @param {...string} args */
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    /** @param {Record<string, string>} files */
    const commit = (files) => {
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(join(dir, path, '..'), { recursive: true });
        writeFileSync(join(dir, path), text);
      }
      git('add', '-A');
      git('commit', '-q', '-m', 'edit');
      return git('rev-parse', 'HEAD');
    };
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    git('config', 'commit.gpgsign', 'false');
    commit({
      'a.txt': 'one\ntwo\nthree\n',
      'plan/STATUS.json': status({ X001: { pct: 0.5, note: 'wip' } }),
      'README.md': readme('0%', 'intro'),
      'docs/progress.svg': '<svg>0</svg>\n',
    });
    git('checkout', '-q', '-b', 'lane');
    const planned = commit(lane);
    git('checkout', '-q', 'main');
    commit(main);
    git('checkout', '-q', 'lane');
    /** The merge as the claude job makes it: merge, then the bookkeeping helper if it stopped. */
    const mergeMain = () => {
      try {
        git('merge', '-q', '--no-ff', '--no-edit', 'main');
      } catch {
        resolve(dir);
      }
      return git('rev-parse', 'HEAD');
    };
    /** Rewrites files in the merge commit, as a careless conflict resolution would. */
    const amend = (/** @type {Record<string, string>} */ files) => {
      for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
      git('commit', '-q', '-a', '--amend', '--no-edit');
      return git('rev-parse', 'HEAD');
    };
    const check = (/** @type {string} */ head) =>
      isMergeOfMain({ planned, head, main: 'main', cwd: dir });
    return { dir, planned, mergeMain, amend, check };
  };

  it('accepts planned plus a clean merge of main', () => {
    const s = scenario({ 'a.txt': 'one\ntwo by the lane\nthree\n' }, { 'b.txt': 'main\n' });
    expect(s.check(s.mergeMain())).toBe(true);
  });

  it('accepts progress-file conflicts resolved by the bookkeeping helper', () => {
    const s = scenario(
      {
        'a.txt': 'one\ntwo by the lane\nthree\n',
        'plan/STATUS.json': status({
          X001: { pct: 0.5, note: 'wip' },
          X002: { pct: 1, note: 'lane' },
        }),
        'README.md': readme('4%', 'intro'),
        'docs/progress.svg': '<svg>4</svg>\n',
      },
      {
        'plan/STATUS.json': status({ X001: { pct: 1, note: 'merged in #1' } }),
        'README.md': readme('5%', 'intro edited on main'),
        'docs/progress.svg': '<svg>5</svg>\n',
      },
    );
    expect(s.check(s.mergeMain())).toBe(true);
  });

  it('rejects a merge that slipped in another change', () => {
    const s = scenario({ 'a.txt': 'one\ntwo by the lane\nthree\n' }, { 'b.txt': 'main\n' });
    s.mergeMain();
    expect(s.check(s.amend({ 'a.txt': 'one\ntwo by the lane\nthree\nsneaky\n' }))).toBe(false);
  });

  it('rejects moved or re-indented lane lines, which a whitespace-blind patch-id would accept', () => {
    const s = scenario({ 'a.txt': 'one\ntwo by the lane\nthree\n' }, { 'b.txt': 'main\n' });
    s.mergeMain();
    expect(s.check(s.amend({ 'a.txt': 'one\n    two by the lane\nthree\n' }))).toBe(false);
    expect(s.check(s.amend({ 'a.txt': 'one\nthree\ntwo by the lane\n' }))).toBe(false);
  });

  it('rejects hand edits to README outside its progress block, or to other lanes in STATUS', () => {
    const s = scenario({ 'a.txt': 'one\ntwo by the lane\nthree\n' }, { 'b.txt': 'main\n' });
    s.mergeMain();
    expect(s.check(s.amend({ 'README.md': readme('0%', 'intro, rewritten') }))).toBe(false);
    const t = scenario({ 'a.txt': 'one\ntwo by the lane\nthree\n' }, { 'b.txt': 'main\n' });
    t.mergeMain();
    expect(
      t.check(t.amend({ 'plan/STATUS.json': status({ X001: { pct: 1, note: 'done!' } }) })),
    ).toBe(false);
  });

  it('rejects a head whose first parent is not the planned commit', () => {
    const s = scenario({ 'a.txt': 'one\ntwo by the lane\nthree\n' }, { 'b.txt': 'main\n' });
    const merged = s.mergeMain();
    expect(isMergeOfMain({ planned: merged, head: s.planned, main: 'main', cwd: s.dir })).toBe(
      false,
    );
  });
});

describe('prompts', () => {
  it.each(['review', 'fix-ci', 'update'])('%s.md has no unfilled placeholder', (name) => {
    const template = readFileSync(
      join(import.meta.dirname, 'claude-prompts', `${name}.md`),
      'utf8',
    );
    const vars = {
      REPO: 'o/r',
      PR: '7',
      LANE,
      LANE_CARDS: `${CONFIG.laneCardDir}/${LANE}.json`,
      FAILED_CHECKS: CHECK,
      FIXES: 'allowed',
      GATES: CONFIG.gates,
      PROTECTED: CONFIG.protectedPaths.join(', '),
    };
    expect(renderPrompt(template, vars)).not.toMatch(/\{\{\w+\}\}/);
  });
});
