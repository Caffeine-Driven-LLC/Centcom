/** Puts a VERIFIED download in place of the program, proves the new program starts, and goes back if it does not.
 *  The order matters, and each step can be cut short by a crash (see `recoverInterrupted`):
 *   1. staged file renamed to `<exe>.new` (same folder, so every later rename is atomic);
 *   2. the running program copied to `<exe>.previous.tmp`, then renamed to `<exe>.previous` (a copy that exists is whole);
 *   3. `<exe>.new` renamed over `<exe>` (the swap: afterwards the program is whole old or whole new, never half);
 *   4. `<exe> --version --json` run for at most 5 s; it must print the version that was promised;
 *   5. on any failure after 3 the previous copy is put back; `<exe>.previous` is always kept.
 *  Nothing downloaded is ever run before step 3 has happened. Must not: verify (the update client did), touch the network, or put a path in an error. */
import type { FsPort, Runner } from './ports.js';

export const HEALTH_TIMEOUT_MS = 5000;
export interface UpdatePlan {
  /** The installed program. */ exe: string;
  /** The verified download, in the same folder. */ staged: string;
  from: string; to: string; platform: NodeJS.Platform;
  /** True while any session (host or guest) is live: the update then waits (`deferred`). */ sessionsLive?: () => boolean;
  healthTimeoutMs?: number;
}
export type ApplyResult = { ok: true; from: string; to: string } | { ok: false; rolledBack: boolean; code: string };
export const markerPaths = (exe: string) => ({ newFile: `${exe}.new`, previous: `${exe}.previous`, tmp: `${exe}.previous.tmp`, restoring: `${exe}.restore.tmp`, away: `${exe}.old` });

const quiet = async (f: () => Promise<void>): Promise<void> => { try { await f(); } catch { /* best effort cleanup */ } };
/** Puts the previous copy back as the program. On Windows the running file is renamed away first. */
async function restorePrevious(fs: FsPort, exe: string, platform: NodeJS.Platform): Promise<boolean> {
  const m = markerPaths(exe);
  try {
    if (platform === 'win32') { await quiet(() => fs.rm(m.away)); await fs.rename(exe, m.away); await fs.copyFile(m.previous, exe); return true; }
    await fs.copyFile(m.previous, m.restoring); await fs.chmod(m.restoring, 0o755); await fs.rename(m.restoring, exe); return true;
  } catch { await quiet(() => fs.rm(m.restoring)); return false; }
}
const healthy = async (runner: Runner, exe: string, to: string, ms: number): Promise<boolean> => {
  try {
    const r = await runner.run(exe, ['--version', '--json'], { timeoutMs: ms }); if (r.timedOut || r.code !== 0) return false;
    const j = JSON.parse(r.stdout.trim().split('\n').pop() ?? '') as { version?: unknown }; return j.version === to;
  } catch { return false; }
};

export async function applyUpdate(plan: UpdatePlan, fs: FsPort, runner: Runner): Promise<ApplyResult> {
  const m = markerPaths(plan.exe);
  if (plan.sessionsLive?.()) return { ok: false, rolledBack: false, code: 'deferred' };
  if (!(await fs.exists(plan.staged))) return { ok: false, rolledBack: false, code: 'staged_missing' };
  const abort = async (code: string): Promise<ApplyResult> => { await quiet(() => fs.rm(m.newFile)); await quiet(() => fs.rm(m.tmp)); await quiet(() => fs.rm(plan.staged)); return { ok: false, rolledBack: false, code }; };
  try { await fs.chmod(plan.staged, 0o755); await fs.rename(plan.staged, m.newFile); } catch { return abort('swap_failed'); }
  try { await quiet(() => fs.rm(m.tmp)); await fs.copyFile(plan.exe, m.tmp); await fs.rename(m.tmp, m.previous); } catch { return abort('swap_failed'); }
  try {
    if (plan.platform === 'win32') { await quiet(() => fs.rm(m.away)); await fs.rename(plan.exe, m.away); try { await fs.rename(m.newFile, plan.exe); } catch (e) { await quiet(() => fs.rename(m.away, plan.exe)); throw e; } }
    else await fs.rename(m.newFile, plan.exe);
  } catch { return abort('swap_failed'); }
  if (await healthy(runner, plan.exe, plan.to, plan.healthTimeoutMs ?? HEALTH_TIMEOUT_MS)) { await quiet(() => fs.rm(m.away)); return { ok: true, from: plan.from, to: plan.to }; }
  const back = await restorePrevious(fs, plan.exe, plan.platform);
  return { ok: false, rolledBack: back, code: back ? 'health_check_failed' : 'rollback_failed' };
}

/**
 * Run at every start, before anything else uses the program. A crash during an update leaves one of these shapes, and each one is settled the safe way:
 *  - the program is missing but `.previous` exists (killed between the two renames on Windows): the previous copy is put back;
 *  - `.new` is still there next to a program that exists: the swap never happened, `.new` is deleted (an unverified-after-crash file is never finished);
 *  - leftover `.tmp` files are deleted.
 */
export async function recoverInterrupted(exe: string, platform: NodeJS.Platform, fs: FsPort): Promise<'clean' | 'restored' | 'discarded' | 'broken'> {
  const m = markerPaths(exe); let result: 'clean' | 'restored' | 'discarded' | 'broken' = 'clean';
  const hasExe = await fs.exists(exe);
  if (!hasExe) { if (await fs.exists(m.away)) { try { await fs.rename(m.away, exe); result = 'restored'; } catch { result = 'broken'; } } else if (await fs.exists(m.previous)) { result = (await restorePrevious(fs, exe, platform)) ? 'restored' : 'broken'; } else result = 'broken'; }
  if (await fs.exists(m.newFile)) { await quiet(() => fs.rm(m.newFile)); if (result === 'clean') result = 'discarded'; }
  await quiet(() => fs.rm(m.tmp)); await quiet(() => fs.rm(m.restoring)); if (hasExe) await quiet(() => fs.rm(m.away));
  return result;
}
