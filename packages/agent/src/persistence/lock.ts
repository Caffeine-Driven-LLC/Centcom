/** One writer per session: a `lock` file holding the writer's pid. A lock whose process is gone is taken over. */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionInUse } from './format.js';

export const pidAlive = (pid: number): boolean => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
export function lockHolder(dir: string, alive = pidAlive): number | undefined { try { const pid = Number(readFileSync(join(dir, 'lock'), 'utf8').trim()); return pid !== process.pid && alive(pid) ? pid : undefined; } catch { return undefined; } }
export function takeLock(dir: string, alive = pidAlive): () => void {
  const path = join(dir, 'lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try { writeFileSync(path, String(process.pid), { flag: 'wx', mode: 0o600 }); return () => { try { if (readFileSync(path, 'utf8').trim() === String(process.pid)) rmSync(path, { force: true }); } catch { /* already gone */ } }; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; let pid = 0; try { pid = Number(readFileSync(path, 'utf8').trim()); } catch { /* raced */ } if (pid === process.pid) return () => undefined; if (alive(pid)) throw new SessionInUse(pid); rmSync(path, { force: true }); } // stale: take it over
  }
  throw new SessionInUse(0);
}
