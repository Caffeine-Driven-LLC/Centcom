/** First-run state: `<state dir>/state.json` with `firstRunCompletedAt`. Other keys in that file are kept. */
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface StateFileFs { read(p: string): Promise<string | undefined>; writeAtomic(p: string, text: string): Promise<void> }
export const nodeStateFileFs: StateFileFs = {
  async read(p) { try { return await readFile(p, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; } },
  async writeAtomic(p, text) { await mkdir(dirname(p), { recursive: true, mode: 0o700 }); const tmp = `${p}.${randomBytes(4).toString('hex')}.tmp`; try { const fh = await open(tmp, 'wx', 0o600); try { await fh.writeFile(text); } finally { await fh.close(); } await chmod(tmp, 0o600); await rename(tmp, p); } catch (e) { await rm(tmp, { force: true }); throw e; } },
};
export interface FirstRunDeps { stateFile: string; fs?: StateFileFs; now?: () => Date }
export const SAVE_FAILED = "Couldn't save setup state. You may see this screen again.";
async function readState(d: FirstRunDeps): Promise<Record<string, unknown>> { try { const t = await (d.fs ?? nodeStateFileFs).read(d.stateFile); const j = t ? JSON.parse(t) : {}; return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; } }
/** True until the first-run screen has been shown and dismissed once. A damaged file counts as not done. */
export async function isFirstRun(d: FirstRunDeps): Promise<boolean> { return typeof (await readState(d)).firstRunCompletedAt !== 'string'; }
/** Remembers that the screen was seen. Never throws: an unwritable folder only means the screen may show again. */
export async function markFirstRunDone(d: FirstRunDeps): Promise<{ ok: true } | { ok: false; message: string }> {
  const cur = await readState(d); try { await (d.fs ?? nodeStateFileFs).writeAtomic(d.stateFile, JSON.stringify({ ...cur, firstRunCompletedAt: (d.now?.() ?? new Date()).toISOString() }, null, 2) + '\n'); return { ok: true }; } catch { return { ok: false, message: SAVE_FAILED }; }
}
