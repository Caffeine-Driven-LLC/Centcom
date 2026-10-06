// @ts-check
/**
 * Claude PR pipeline state machine: one next step per PR state, merge only when everything holds.
 * Repository-agnostic: the same tests run in Centcom and Centcom-backend against each one's
 * claude-pr.config.json.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_STATUS,
  CONFIG,
  MAX_FIX_ROUNDS,
  REQUIRED_CHECKS,
  laneIds,
  nextStep,
  queueHead,
  renderPrompt,
} from './claude-pr-state.mjs';

/** @typedef {import('./claude-pr-state.mjs').PullRequest} PullRequest */
/** @typedef {import('./claude-pr-state.mjs').Check} Check */

/** A lane ID in this repository's scheme (`B040` or `C040`). */
const LANE = `${CONFIG.lanePattern[0]}040`;
/** Any required check, standing in for "a check that fails". */
const CHECK = REQUIRED_CHECKS.find((n) => n !== CONFIG.titleCheck) ?? '';

/** @param {string} name @param {Partial<{ status: string, conclusion: string, startedAt: string }>} [over] */
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
const files = ['apps/relay/src/index.ts'];
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
  ])('hands %s changes to a human', (f) =>
    expect(nextStep(pr(), [...files, f], 0, false).action).toBe('needs-human'),
  );

  it('lets a lane PR add dependencies and update plan/STATUS.json, but no other plan/ file', () => {
    const lane = [...files, 'pnpm-lock.yaml', 'plan/STATUS.json', 'README.md', 'docs/progress.svg'];
    expect(nextStep(pr(), lane, 0, false).action).toBe('merge');
    expect(nextStep(pr(), [...lane, 'plan/STATUS.md'], 0, false).action).toBe('needs-human');
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

  it('waits for checks that are missing or running after an approval', () => {
    const rollup = [claude('SUCCESS')];
    expect(action({ statusCheckRollup: rollup })).toBe('wait');
  });

  it('updates from main when conflicting (first) or behind (last), and waits on UNKNOWN', () => {
    expect(action({ mergeable: 'CONFLICTING', statusCheckRollup: [] })).toBe('update');
    expect(action({ mergeable: 'CONFLICTING', commits: fixCommits(MAX_FIX_ROUNDS) })).toBe(
      'needs-human',
    );
    expect(action({}, 2)).toBe('update');
    expect(action({ mergeable: 'UNKNOWN' })).toBe('wait');
  });

  it('does not count clean merges of main as fix rounds', () => {
    const commits = [
      ...fixCommits(MAX_FIX_ROUNDS - 1),
      { messageHeadline: "Merge remote-tracking branch 'origin/main' into lane/x040-thing" },
    ];
    expect(action({ commits, mergeable: 'CONFLICTING' })).toBe('update');
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

  it('never queues conflict resolution: a conflicting PR updates at once', () => {
    expect(nextStep(pr({ number: 9, mergeable: 'CONFLICTING' }), files, 3, false, 4).action).toBe(
      'update',
    );
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
