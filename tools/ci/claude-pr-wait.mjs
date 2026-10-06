// @ts-check
/**
 * Waits for the Claude PR pipeline (.github/workflows/claude-pr.yml) to finish with a PR, so a
 * local Claude Code session can run it in the background and be woken once, when it exits. When
 * the PR goes quiet it re-dispatches the pipeline for it (with your own gh login, so it costs no
 * Actions minutes), which covers lost events between the pipeline's rare scheduled sweeps.
 *
 * Usage: node tools/ci/claude-pr-wait.mjs <pr> [--interval <s>] [--idle <min>] [--max <min>]
 *   Polls every 180 s, re-dispatches after 20 quiet minutes, and gives up after 90 minutes with no
 *   activity (a push, comment, label, check or claude-review change) or 240 minutes in all.
 * Exit codes:
 *   0 merged: run `git fetch origin`, then pick the next lane
 *   2 handed off (claude-needs-human, do-not-merge, changes requested, or claude-automerge
 *     removed by someone): leave the PR alone
 *   3 closed without merging
 *   4 timed out: the pipeline may be paused, broken or out of Actions minutes
 *   5 not opted in: the PR never had the claude-automerge label
 *   1 usage error, or `gh` failed 5 polls in a row
 */
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { changesRequestedBy } from './claude-pr-state.mjs';

export const EXIT = { merged: 0, handoff: 2, closed: 3, timeout: 4, 'not-opted-in': 5 };
const REDISPATCH_AFTER = 20 * 60_000;

/**
 * @typedef {{
 *   state: string, updatedAt: string, headRefOid: string, labels: { name: string }[],
 *   reviews: { author: { login: string }, state: string }[],
 *   mergeCommit: { oid: string } | null,
 *   statusCheckRollup?: { name?: string, context?: string, status?: string, conclusion?: string,
 *     state?: string }[],
 * }} WatchedPr
 * @typedef {keyof typeof EXIT | 'pending'} Outcome
 */

/**
 * Whether the pipeline is done with the PR, and how.
 * @param {WatchedPr} pr
 * @param {boolean} [seenOptIn] an earlier poll saw the claude-automerge label
 * @returns {{ outcome: Outcome, detail: string }}
 */
export function classify(pr, seenOptIn = false) {
  const labels = pr.labels.map((l) => l.name);
  if (pr.state === 'MERGED') {
    return { outcome: 'merged', detail: `merged as ${pr.mergeCommit?.oid}` };
  }
  if (pr.state === 'CLOSED') return { outcome: 'closed', detail: 'closed without merging' };
  for (const label of ['claude-needs-human', 'do-not-merge']) {
    if (labels.includes(label)) return { outcome: 'handoff', detail: `labelled ${label}` };
  }
  const requesters = changesRequestedBy(pr.reviews);
  if (requesters.length > 0) {
    return { outcome: 'handoff', detail: `${requesters.join(', ')} requested changes` };
  }
  if (!labels.includes('claude-automerge')) {
    return seenOptIn
      ? { outcome: 'handoff', detail: 'claude-automerge was removed: a human took the PR over' }
      : { outcome: 'not-opted-in', detail: 'no claude-automerge label' };
  }
  return { outcome: 'pending', detail: `head ${pr.headRefOid.slice(0, 7)}` };
}

/**
 * What counts as the pipeline doing something: PR-level changes, plus the head's checks and
 * claude-review status (neither moves the PR's updatedAt).
 * @param {WatchedPr} pr
 */
export const fingerprint = (pr) =>
  [
    pr.updatedAt,
    pr.headRefOid,
    ...(pr.statusCheckRollup ?? []).map(
      (c) => `${c.name ?? c.context}:${c.status ?? ''}:${c.conclusion ?? c.state ?? ''}`,
    ),
  ].join('|');

/**
 * Value of `--name <n>` in argv, or the fallback.
 * @param {string[]} argv
 * @param {string} name
 * @param {number} fallback
 */
const option = (argv, name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  const value = i === -1 ? fallback : Number(argv[i + 1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} needs a positive number`);
  return value;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const number = argv[0] ?? '';
  if (!/^\d+$/.test(number)) {
    console.error(
      'Usage: node tools/ci/claude-pr-wait.mjs <pr> [--interval <s>] [--idle <min>] [--max <min>]',
    );
    process.exit(1);
  }
  const interval = option(argv, 'interval', 180) * 1000;
  const idle = option(argv, 'idle', 90) * 60_000;
  const deadline = Date.now() + option(argv, 'max', 240) * 60_000;
  const fields = 'state,updatedAt,headRefOid,labels,reviews,mergeCommit,statusCheckRollup';
  let failures = 0;
  let seenOptIn = false;
  let lastActivity = Date.now();
  let lastNudge = Date.now();
  let lastSeen = '';

  for (;;) {
    try {
      /** @type {WatchedPr} */
      const pr = JSON.parse(
        execFileSync('gh', ['pr', 'view', number, '--json', fields], { encoding: 'utf8' }),
      );
      failures = 0;
      const { outcome, detail } = classify(pr, seenOptIn);
      if (outcome === 'pending') seenOptIn = true;
      else {
        const next =
          outcome === 'merged' ? ' Next: `git fetch origin`, then pick the next lane.' : '';
        console.log(`PR #${number}: ${outcome} (${detail}).${next}`);
        process.exit(EXIT[outcome]);
      }
      const seen = fingerprint(pr);
      if (seen !== lastSeen) {
        lastSeen = seen;
        lastActivity = Date.now();
        console.log(`${new Date().toISOString()} PR #${number}: in the pipeline (${detail})`);
      }
    } catch (error) {
      failures += 1;
      console.error(`gh failed (${failures}/5): ${error instanceof Error ? error.message : error}`);
      if (failures >= 5) process.exit(1);
    }
    const now = Date.now();
    if (now - lastActivity >= REDISPATCH_AFTER && now - lastNudge >= REDISPATCH_AFTER) {
      lastNudge = now;
      try {
        execFileSync('gh', ['workflow', 'run', 'claude-pr.yml', '-f', `pr=${number}`]);
        console.log(`${new Date().toISOString()} PR #${number}: quiet for a while; re-planned it`);
      } catch (error) {
        console.error(`could not re-dispatch claude-pr.yml: ${error}`);
      }
    }
    if (now - lastActivity > idle || now > deadline) {
      const why = now > deadline ? 'the overall limit' : 'no activity';
      console.log(
        `PR #${number}: timeout (${why}). Check CLAUDE_AUTOMERGE, the claude-pr runs and the Actions minutes budget.`,
      );
      process.exit(EXIT.timeout);
    }
    await sleep(interval);
  }
}
