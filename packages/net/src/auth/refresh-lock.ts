/** A cross-process lock around token refresh: one exclusive file in `lockDir`. A crashed holder's lock goes stale after 10 s and is taken over; a live holder keeps it fresh.
 *  Must not: write anything secret into the lock file (it holds a pid and a random owner id); wait without a bound; remove a lock it does not own. */
import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';

/** A lock older than this (by mtime) belongs to a holder that crashed. */
export const LOCK_STALE_MS = 10_000;
/** How long acquire() waits before giving up. */
export const LOCK_ACQUIRE_TIMEOUT_MS = 30_000;
/** A live holder touches the lock this often, so it never looks stale. */
export const LOCK_HEARTBEAT_MS = 2_000;
export const LOCK_FILE = 'auth-refresh.lock';

export class RefreshLockTimeoutError extends Error { constructor() { super('timed out waiting for the refresh lock'); this.name = 'RefreshLockTimeoutError'; } }

export interface RefreshLockOptions {
  staleMs?: number; acquireTimeoutMs?: number; heartbeatMs?: number;
  /** wall-clock now (compared with file mtimes) */
  now?: () => number;
  /** real-time sleep between tries */
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
}
export interface LockHandle { release(): Promise<void> }

const realSleep = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); }); /* not unref: a waiting process must stay alive */
const code = (e: unknown) => (e as { code?: string })?.code;

/** Take the lock in `lockDir`, run `fn`, release, even when `fn` throws. */
export async function withRefreshLock<T>(lockDir: string, fn: () => Promise<T>, o: RefreshLockOptions = {}): Promise<T> {
  const h = await acquireRefreshLock(lockDir, o);
  try { return await fn(); } finally { await h.release(); }
}

/** Wait for the lock (polling with jitter), taking over a stale one. Throws RefreshLockTimeoutError after `acquireTimeoutMs`. */
export async function acquireRefreshLock(lockDir: string, o: RefreshLockOptions = {}): Promise<LockHandle> {
  const staleMs = o.staleMs ?? LOCK_STALE_MS; const now = o.now ?? Date.now; const sleep = o.sleep ?? realSleep; const rng = o.rng ?? Math.random;
  const path = join(lockDir, LOCK_FILE); const owner = randomBytes(12).toString('hex'); const until = now() + (o.acquireTimeoutMs ?? LOCK_ACQUIRE_TIMEOUT_MS);
  await fsp.mkdir(lockDir, { recursive: true, mode: 0o700 });
  for (let tries = 0; ; tries++) {
    try {
      const fh = await fsp.open(path, 'wx', 0o600);
      try { await fh.writeFile(JSON.stringify({ pid: process.pid, owner })); } finally { await fh.close(); }
      return held(path, owner, o.heartbeatMs ?? LOCK_HEARTBEAT_MS);
    } catch (e) { if (code(e) !== 'EEXIST') throw e; }
    await takeOverIfStale(path, staleMs, now);
    if (now() >= until) throw new RefreshLockTimeoutError();
    await sleep(Math.min(250, 20 * 2 ** Math.min(tries, 3)) * (0.5 + rng()));
  }
}

/** Move a stale lock aside (rename is atomic, so only one waiter gets it). If what we moved turns out to be fresh, someone else just took it: put it back. */
async function takeOverIfStale(path: string, staleMs: number, now: () => number): Promise<void> {
  let st; try { st = await fsp.stat(path); } catch { return; }
  if (now() - st.mtimeMs <= staleMs) return;
  const aside = `${path}.stale-${randomBytes(6).toString('hex')}`;
  try { await fsp.rename(path, aside); } catch { return; }
  try {
    const moved = await fsp.stat(aside);
    if (now() - moved.mtimeMs <= staleMs) { try { await fsp.link(aside, path); } catch { /* a newer lock is already there */ } }
  } finally { await fsp.rm(aside, { force: true }); }
}

function held(path: string, owner: string, heartbeatMs: number): LockHandle {
  const beat = setInterval(() => { const t = new Date(); void fsp.utimes(path, t, t).catch(() => undefined); }, heartbeatMs); beat.unref?.();
  let released = false;
  return {
    async release() {
      if (released) return; released = true; clearInterval(beat);
      try { const j = JSON.parse(await fsp.readFile(path, 'utf8')) as { owner?: string }; if (j.owner === owner) await fsp.rm(path, { force: true }); } catch { /* gone or taken over */ }
    },
  };
}
