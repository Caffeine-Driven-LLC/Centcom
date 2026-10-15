/**
 * A stopped turn can leave git's own `index.lock` behind (the agent's `git add` was killed half-way), and then every later git command in that folder says
 * "another git process seems to be running". This removes that one file, and only when it is certain to be a leftover of the turn that was just stopped:
 *  - it is a regular file in the repository's own git folder (asked from git, so a worktree's separate folder is found too);
 *  - it was made during the stopped turn (not older), so a lock held by something the person started themselves is never touched;
 *  - nothing registered by Centcom for the agent is still alive (the caller says so), and the file did not change during a short settle time;
 *  - it is owned by this user, and no process has it open (git keeps index.lock open while it works, so a `git commit` the person started themselves is
 *    recognised even when its lock is as new as the turn's); when that cannot be told, the file stays.
 * Deleting other people's lock files is never done; if any rule is not met the file stays and the result says why.
 */
import { execFile } from 'node:child_process';
import { lstat, readFile, readdir, readlink, realpath, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { GitRunner } from '../worktrees/git.js';

export type StaleLockReason = 'removed' | 'none' | 'older_than_turn' | 'not_a_file' | 'still_running' | 'changed' | 'git_failed' | 'in_use' | 'unsure' | 'not_ours';
export interface StaleLockResult { removed: boolean; reason: StaleLockReason }
export interface StaleLockDeps {
  git: GitRunner; cwd: string;
  /** When the stopped turn began (ms since the epoch); a lock made before that is not ours. */
  turnStartedAt: number;
  /** False while a process Centcom started for this agent could still be writing. */
  processesGone(): boolean;
  /** How long the file must stay unchanged (default 300 ms). */
  settleMs?: number;
  sleep?: (ms: number) => Promise<void>;
  fs?: { lstat(p: string): Promise<{ isFile(): boolean; mtimeMs: number; size: number; uid?: number }>; unlink(p: string): Promise<void> };
  /** Whether any process has the file open: `held`, `none`, or `unsure` (the default looks at /proc, then at `lsof`). */
  holders?(path: string): Promise<'held' | 'none' | 'unsure'>;
}
/** Linux: the open files of this user's processes (/proc/<pid>/fd); elsewhere `lsof`. Anything that cannot be read is `unsure`, which keeps the lock. */
export async function openHolders(path: string): Promise<'held' | 'none' | 'unsure'> {
  let real: string; try { real = await realpath(path); } catch { return 'none'; }
  let pids: string[] | undefined; try { pids = (await readdir('/proc')).filter((n) => /^\d+$/.test(n)); } catch { pids = undefined; }
  if (pids) {
    const me = process.getuid?.(); let unsure = false;
    for (const pid of pids) {
      try { if (me !== undefined && (await stat(`/proc/${pid}`)).uid !== me) continue; } catch { continue; } // gone, or not ours to look at
      let fds: string[]; try { fds = await readdir(`/proc/${pid}/fd`); } catch (e) { const c = (e as NodeJS.ErrnoException).code; if (c !== 'ENOENT' && c !== 'ESRCH' && (await readFile(`/proc/${pid}/comm`, 'utf8').catch(() => 'git')).startsWith('git')) unsure = true; /* a process that hides its files (a browser, a helper) is not git; one that is, or cannot be told, keeps the lock */ continue; }
      for (const fd of fds) { try { if ((await readlink(`/proc/${pid}/fd/${fd}`)) === real) return 'held'; } catch { /* closed meanwhile */ } }
    }
    return unsure ? 'unsure' : 'none';
  }
  return new Promise((resolve) => { execFile('lsof', ['-t', '--', real], { timeout: 5000 }, (err, out) => { if (!err) resolve(out.trim() ? 'held' : 'none'); else resolve((err as { code?: number | string }).code === 1 && !String(out).trim() ? 'none' : 'unsure'); }); });
}
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Removes the leftover `index.lock` of a stopped turn, when every rule above holds. Never throws. */
export async function removeStaleIndexLock(d: StaleLockDeps): Promise<StaleLockResult> {
  const fs = d.fs ?? { lstat, unlink }; const sleep = d.sleep ?? realSleep;
  try {
    const g = await d.git.run(['rev-parse', '--git-path', 'index.lock'], { cwd: d.cwd, timeoutMs: 5000, maxBytes: 4096 });
    if (g.code !== 0) return { removed: false, reason: 'git_failed' };
    const rel = g.stdout.trim(); if (!rel) return { removed: false, reason: 'git_failed' }; const path = isAbsolute(rel) ? rel : join(d.cwd, rel);
    let st; try { st = await fs.lstat(path); } catch { return { removed: false, reason: 'none' }; }
    if (!st.isFile()) return { removed: false, reason: 'not_a_file' };
    const me = process.getuid?.(); if (st.uid !== undefined && me !== undefined && st.uid !== me) return { removed: false, reason: 'not_ours' };
    const holders = d.holders ?? openHolders;
    if (st.mtimeMs < d.turnStartedAt - 1000) return { removed: false, reason: 'older_than_turn' };
    if (!d.processesGone()) return { removed: false, reason: 'still_running' };
    { const h = await holders(path); if (h === 'held') return { removed: false, reason: 'in_use' }; if (h === 'unsure') return { removed: false, reason: 'unsure' }; }
    await sleep(d.settleMs ?? 300);
    let again; try { again = await fs.lstat(path); } catch { return { removed: false, reason: 'none' }; }
    if (!again.isFile() || again.mtimeMs !== st.mtimeMs || again.size !== st.size) return { removed: false, reason: 'changed' };
    if (!d.processesGone()) return { removed: false, reason: 'still_running' };
    { const h = await holders(path); if (h === 'held') return { removed: false, reason: 'in_use' }; if (h === 'unsure') return { removed: false, reason: 'unsure' }; } // checked again right before the delete
    await fs.unlink(path); return { removed: true, reason: 'removed' };
  } catch { return { removed: false, reason: 'git_failed' }; }
}
