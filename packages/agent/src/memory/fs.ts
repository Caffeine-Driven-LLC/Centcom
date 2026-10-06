import { chmod, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface MemFs { read(path: string): Promise<{ bytes: Buffer; mode: number } | undefined>; writeAtomic(path: string, bytes: Buffer, mode?: number): Promise<void> }
/** Temp file, then rename: a crash in between leaves the old file as it was. An existing file keeps its mode; a new one is 0644. */
export function nodeMemFs(hooks: { beforeRename?: () => void | Promise<void> } = {}): MemFs {
  return {
    async read(path) { try { const [bytes, st] = await Promise.all([readFile(path), stat(path)]); return { bytes, mode: st.mode & 0o777 }; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; } },
    async writeAtomic(path, bytes, mode) {
      const existing = await stat(path).then((s) => s.mode & 0o777, () => undefined); await mkdir(dirname(path), { recursive: true }); const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
      try { const fh = await open(tmp, 'w', 0o600); try { await fh.writeFile(bytes); await fh.sync(); } finally { await fh.close(); } await chmod(tmp, existing ?? mode ?? 0o644); await hooks.beforeRename?.(); await rename(tmp, path); }
      catch (e) { await rm(tmp, { force: true }); throw e; } // the original is untouched and no temp file stays behind
    },
  };
}
