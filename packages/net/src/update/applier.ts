/** Puts a verified file in place of the installed program: a rename in the same folder, the old one kept as `.prev` for a rollback. */
import { chmod, copyFile, rename, rm, stat } from 'node:fs/promises';
import { UpdateError } from './errors.js';

export interface ApplyPaths { exe: string; staged: string; prev: string }
export async function applyBinary(p: ApplyPaths, platform: NodeJS.Platform): Promise<{ restartRequired: boolean }> {
  await chmod(p.staged, 0o755);
  await rm(p.prev, { force: true });
  if (platform === 'win32') { await rename(p.exe, p.prev); /* a running .exe can be renamed away but not overwritten */ try { await rename(p.staged, p.exe); } catch (e) { await rename(p.prev, p.exe).catch(() => undefined); throw new UpdateError('apply_failed', 'The new version could not be put in place, so the old one was kept.'); } return { restartRequired: true }; }
  await copyFile(p.exe, p.prev); try { await rename(p.staged, p.exe); } catch { await rm(p.prev, { force: true }); throw new UpdateError('apply_failed', 'The new version could not be put in place, so the old one was kept.'); }
  return { restartRequired: true };
}
export async function rollbackBinary(p: Pick<ApplyPaths, 'exe' | 'prev'>, platform: NodeJS.Platform): Promise<void> {
  try { await stat(p.prev); } catch { throw new UpdateError('no_previous', 'There is no earlier version saved to go back to.'); }
  if (platform === 'win32') { const away = `${p.exe}.old`; await rm(away, { force: true }); await rename(p.exe, away); await rename(p.prev, p.exe); return; }
  await rename(p.prev, p.exe);
}
