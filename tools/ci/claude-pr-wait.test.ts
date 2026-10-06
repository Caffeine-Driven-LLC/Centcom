// @ts-check
/** Claude PR waiter: tells merged, handed off, closed and not-opted-in apart from still pending. */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT, classify, fingerprint } from './claude-pr-wait.mjs';

/** @typedef {import('./claude-pr-wait.mjs').WatchedPr} WatchedPr */

/** @param {Partial<WatchedPr>} [over] @returns {WatchedPr} */
const pr = (over = {}) => ({
  state: 'OPEN',
  updatedAt: '2026-10-06T01:00:00Z',
  headRefOid: 'abcdef1234567890abcdef1234567890abcdef12',
  labels: [{ name: 'claude-automerge' }],
  reviews: [],
  mergeCommit: null,
  ...over,
});
/** @param {...string} names */
const labels = (...names) => names.map((name) => ({ name }));

describe('classify', () => {
  it('is pending while an opted-in PR is open', () => {
    expect(classify(pr())).toEqual({ outcome: 'pending', detail: 'head abcdef1' });
  });

  it('reports a merge with its commit', () => {
    expect(classify(pr({ state: 'MERGED', mergeCommit: { oid: 'f00' } }))).toEqual({
      outcome: 'merged',
      detail: 'merged as f00',
    });
  });

  it('reports a close without merge', () => {
    expect(classify(pr({ state: 'CLOSED' })).outcome).toBe('closed');
  });

  it.each(['claude-needs-human', 'do-not-merge'])('treats %s as a handoff', (label) => {
    expect(classify(pr({ labels: labels('claude-automerge', label) }))).toEqual({
      outcome: 'handoff',
      detail: `labelled ${label}`,
    });
  });

  it('treats a standing changes-requested review as a handoff', () => {
    const reviews = [
      { author: { login: 'AlexanderGese' }, state: 'COMMENTED' },
      { author: { login: 'AlexanderGese' }, state: 'CHANGES_REQUESTED' },
    ];
    expect(classify(pr({ reviews }))).toEqual({
      outcome: 'handoff',
      detail: 'AlexanderGese requested changes',
    });
    const replied = [...reviews, { author: { login: 'AlexanderGese' }, state: 'COMMENTED' }];
    expect(classify(pr({ reviews: replied })).outcome).toBe('handoff');
    const resolved = [...reviews, { author: { login: 'AlexanderGese' }, state: 'APPROVED' }];
    expect(classify(pr({ reviews: resolved })).outcome).toBe('pending');
  });

  it('reports a PR that never had the opt-in label instead of waiting on it', () => {
    expect(classify(pr({ labels: [] })).outcome).toBe('not-opted-in');
  });

  it('treats the opt-in label disappearing after it was seen as a human taking over', () => {
    expect(classify(pr({ labels: [] }), true)).toEqual({
      outcome: 'handoff',
      detail: 'claude-automerge was removed: a human took the PR over',
    });
  });

  it('keeps the documented exit codes', () => {
    expect(EXIT).toEqual({ merged: 0, handoff: 2, closed: 3, timeout: 4, 'not-opted-in': 5 });
  });
});

describe('fingerprint', () => {
  it('counts a finished check or a new claude-review status as activity', () => {
    const running = pr({ statusCheckRollup: [{ name: 'test', status: 'IN_PROGRESS' }] });
    const done = pr({
      statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    });
    const approved = pr({
      statusCheckRollup: [
        { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { context: 'claude-review', state: 'SUCCESS' },
      ],
    });
    expect(new Set([running, done, approved].map(fingerprint)).size).toBe(3);
  });
});

describe('CLI', () => {
  it('exits 1 with usage when the PR number is missing', () => {
    const script = join(import.meta.dirname, 'claude-pr-wait.mjs');
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 30_000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage');
  });
});
