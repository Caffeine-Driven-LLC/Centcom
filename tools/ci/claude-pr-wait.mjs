// @ts-check
/**
 * Waits for the Claude PR pipeline (.github/workflows/claude-pr.yml) to finish with a PR, so a
 * local Claude Code session can run it in the background and be woken once, when it exits.
 *
 * Usage: node tools/ci/claude-pr-wait.mjs <pr> [--interval <s>] [--idle <min>] [--max <min>]
 *   Polls every 180 s. Gives up after 60 min with no activity on the PR, or 240 min in all.
 * Exit codes:
 *   0 merged: pull main and start the next lane
 *   2 handed off (claude-needs-human, do-not-merge, or changes requested): leave the PR alone
 *   3 closed without merging
 *   4 timed out: the pipeline may be broken or paused
 *   5 not opted in: the PR has no claude-automerge label
 *   1 usage error, or `gh` failed 5 polls in a row
 */
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const EXIT = { merged: 0, handoff: 2, closed: 3, timeout: 4, 'not-opted-in': 5 };

/**
 * @typedef {{
 *   state: string, updatedAt: string, headRefOid: string, labels: { name: string }[],
 *   reviews: { author: { login: string }, state: string }[],
 *   mergeCommit: { oid: string } | null,
 * }} WatchedPr
 * @typedef {keyof typeof EXIT | 'pending'} Outcome
 */

/**
 * Whether the pipeline is done with the PR, and how.
 * @param {WatchedPr} pr
 * @returns {{ outcome: Outcome, detail: string }}
 */
export function classify(pr) {
  const labels = pr.labels.map((l) => l.name);
  if (pr.state === 'MERGED')
    return { outcome: 'merged', detail: `merged as ${pr.mergeCommit?.oid}` };
  if (pr.state === 'CLOSED') return { outcome: 'closed', detail: 'closed without merging' };
  for (const label of ['claude-needs-human', 'do-not-merge']) {
    if (labels.includes(label)) return { outcome: 'handoff', detail: `labelled ${label}` };
  }
  const latest = new Map(pr.reviews.map((r) => [r.author.login, r.state]));
  const requester = [...latest].find(([, state]) => state === 'CHANGES_REQUESTED')?.[0];
  if (requester) return { outcome: 'handoff', detail: `${requester} requested changes` };
  if (!labels.includes('claude-automerge')) {
    return { outcome: 'not-opted-in', detail: 'no claude-automerge label' };
  }
  return { outcome: 'pending', detail: `head ${pr.headRefOid.slice(0, 7)}` };
}

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
  const idle = option(argv, 'idle', 60) * 60_000;
  const deadline = Date.now() + option(argv, 'max', 240) * 60_000;
  const fields = 'state,updatedAt,headRefOid,labels,reviews,mergeCommit';
  let failures = 0;
  let lastActivity = Date.now();
  let lastSeen = '';

  for (;;) {
    try {
      /** @type {WatchedPr} */
      const pr = JSON.parse(
        execFileSync('gh', ['pr', 'view', number, '--json', fields], { encoding: 'utf8' }),
      );
      failures = 0;
      const { outcome, detail } = classify(pr);
      if (outcome !== 'pending') {
        console.log(`PR #${number}: ${outcome} (${detail})`);
        process.exit(EXIT[outcome]);
      }
      // A push, comment or label change counts as activity; quiet CI runs do not, hence the
      // generous idle limit.
      const seen = `${pr.updatedAt} ${pr.headRefOid}`;
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
    if (now - lastActivity > idle || now > deadline) {
      const why = now > deadline ? 'the overall limit' : 'no activity';
      console.log(`PR #${number}: timeout (${why}); check the claude-pr workflow runs`);
      process.exit(EXIT.timeout);
    }
    await sleep(interval);
  }
}
