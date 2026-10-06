// @ts-check
/**
 * Progress bookkeeping for the Claude PR pipeline: plan/STATUS.json, README.md's progress block and
 * docs/progress.svg (tools/plan/progress.py). Lane PRs used to edit all three, so every merge made
 * every other open lane PR conflict; now the merge job records merged lanes on main, and this module
 * resolves the conflicts older PRs still carry. Node built-ins only: the claude job runs main's copy
 * of this file from $RUNNER_TEMP inside a PR checkout whose own tools/ci may predate it.
 *
 * Usage, inside a checkout where `git merge --no-ff origin/main` just ran:
 *   node claude-pr-bookkeeping.mjs refresh   the merge was clean: regenerate the progress files and
 *                                            amend the merge commit if they changed
 *   node claude-pr-bookkeeping.mjs resolve   the merge stopped on conflicts: resolve those in the three
 *                                            files, and if nothing else conflicts, regenerate and commit
 * Both print a JSON summary. Anything they cannot resolve is left for Claude.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATUS = 'plan/STATUS.json';
export const README = 'README.md';
export const SVG = 'docs/progress.svg';
export const BOOKKEEPING = [STATUS, README, SVG];
const PROGRESS = 'tools/plan/progress.py';
const START = '<!-- progress:start -->';
const END = '<!-- progress:end -->';

/**
 * @typedef {{ pct?: number, note?: string }} Lane
 * @typedef {{ lanes?: Record<string, Lane>, [key: string]: unknown }} Status
 */

/**
 * Serialises STATUS.json the way it is kept: one-space indent, ASCII only (Python's json.dump).
 * @param {Status} status
 */
export const writeStatus = (status) =>
  JSON.stringify(status, null, 1).replace(
    /[\u0080-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  ) + '\n';

/**
 * Records lanes as merged by a PR.
 * @param {string} text current STATUS.json
 * @param {string[]} lanes
 * @param {string | number} pr
 * @param {string} today YYYY-MM-DD
 */
export function markMerged(text, lanes, pr, today) {
  /** @type {Status} */
  const status = JSON.parse(text);
  const entries = (status.lanes ??= {});
  for (const id of lanes) entries[id] = { pct: 1, note: `merged in #${pr}` };
  status.updated = today;
  return writeStatus(status);
}

/** @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Three-way merge of STATUS.json. Main's file wins, then each lane the PR changed is applied on
 * top, except where main changed the same lane to a higher pct.
 * @param {string | null} baseText null when both sides added the file
 * @param {string} oursText the PR's
 * @param {string} theirsText main's
 */
export function mergeStatus(baseText, oursText, theirsText) {
  /** @type {Status} */ const base = baseText ? JSON.parse(baseText) : {};
  /** @type {Status} */ const ours = JSON.parse(oursText);
  /** @type {Status} */ const theirs = JSON.parse(theirsText);
  /** @type {Status} */ const out = JSON.parse(theirsText);
  const lanes = (out.lanes ??= {});
  for (const [id, entry] of Object.entries(ours.lanes ?? {})) {
    const before = base.lanes?.[id];
    if (same(entry, before)) continue;
    const other = theirs.lanes?.[id];
    if (other === undefined || same(other, before) || (entry.pct ?? 0) > (other.pct ?? 0)) {
      lanes[id] = entry;
    }
  }
  return writeStatus(out);
}

/** @param {string} s */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BLOCK = new RegExp(`${escapeRegExp(START)}[\\s\\S]*?${escapeRegExp(END)}`);

/**
 * Empties README's generated progress block, so the rest of the file can merge on its own.
 * @param {string} text
 */
export const stripProgress = (text) => text.replace(BLOCK, `${START}\n${END}`);

/**
 * `git merge-file` on three texts; null when they conflict.
 * @param {string} base
 * @param {string} ours
 * @param {string} theirs
 */
export function mergeText(base, ours, theirs) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-pr-merge-'));
  try {
    const [o, b, t] = ['ours', 'base', 'theirs'].map((name, i) => {
      const file = join(dir, name);
      writeFileSync(file, [ours, base, theirs][i] ?? '');
      return file;
    });
    const result = spawnSync('git', ['merge-file', '-p', o ?? '', b ?? '', t ?? ''], {
      encoding: 'utf8',
    });
    return result.status === 0 ? result.stdout : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * @param {string} [cwd]
 * @returns {(...args: string[]) => string}
 */
export const gitIn =
  (cwd) =>
  (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/**
 * A file's text at merge stage 1 (base), 2 (ours) or 3 (theirs); null if absent at that stage.
 * @param {number} n
 * @param {string} file
 * @param {string} [cwd]
 */
const stage = (n, file, cwd) => {
  const r = spawnSync('git', ['show', `:${n}:${file}`], { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
};

/**
 * Regenerates README's progress block and the SVG from STATUS.json, and stages them.
 * @param {string} [cwd]
 */
export function regenerate(cwd) {
  if (!existsSync(join(cwd ?? '.', PROGRESS))) return false;
  execFileSync('python3', [PROGRESS], {
    cwd,
    stdio: 'ignore',
    env: { ...process.env, PYTHONUTF8: '1' },
  });
  gitIn(cwd)('add', '--', README, SVG);
  return true;
}

/**
 * Resolves conflicts in the bookkeeping files of a stopped merge.
 * @param {string} [cwd]
 */
export function resolve(cwd) {
  const git = gitIn(cwd);
  const unmerged = () => git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
  const resolved = [];
  for (const file of unmerged().filter((f) => BOOKKEEPING.includes(f))) {
    const [base, ours, theirs] = [1, 2, 3].map((n) => stage(n, file, cwd));
    if (ours == null || theirs == null) continue; // deleted on one side: Claude decides
    // The SVG is generated, so main's copy will do until it is regenerated below.
    const text =
      file === STATUS
        ? mergeStatus(base ?? null, ours, theirs)
        : file === SVG
          ? theirs
          : mergeText(stripProgress(base ?? ''), stripProgress(ours), stripProgress(theirs));
    if (text === null) continue;
    writeFileSync(join(cwd ?? '.', file), text);
    git('add', '--', file);
    resolved.push(file);
  }
  const remaining = unmerged();
  let committed = false;
  if (remaining.length === 0 && resolved.length > 0) {
    regenerate(cwd);
    git('commit', '--no-edit');
    committed = true;
  }
  return { resolved, remaining, committed };
}

/**
 * After a clean merge: regenerate the progress files and amend the merge commit if they changed.
 * @param {string} [cwd]
 */
export function refresh(cwd) {
  const git = gitIn(cwd);
  if (!regenerate(cwd)) return { amended: false };
  const changed = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd }).status !== 0;
  if (changed) git('commit', '--amend', '--no-edit');
  return { amended: changed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === 'resolve') console.log(JSON.stringify(resolve()));
  else if (command === 'refresh') console.log(JSON.stringify(refresh()));
  else {
    console.error('Usage: node claude-pr-bookkeeping.mjs resolve|refresh');
    process.exit(1);
  }
}
