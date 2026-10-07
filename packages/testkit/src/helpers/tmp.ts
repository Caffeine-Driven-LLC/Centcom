/** Temporary folders that clean up after themselves, even when a test forgets: everything still open is removed when the process exits. */
import { mkdtemp, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const open = new Set<string>(); let hooked = false;
export interface TmpDir { path: string; dispose(): Promise<void> }
export async function tmpDir(prefix = 'centcom-test-'): Promise<TmpDir> {
  const path = await mkdtemp(join(tmpdir(), prefix)); open.add(path);
  if (!hooked) { hooked = true; process.on('exit', () => { for (const p of open) { try { rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ } } }); }
  return { path, async dispose() { open.delete(path); await rm(path, { recursive: true, force: true }); } };
}
export const openTmpDirs = (): string[] => [...open];
