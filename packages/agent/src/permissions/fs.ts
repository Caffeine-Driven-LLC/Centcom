import { appendFile, mkdir, open, readFile, realpath, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface PermFs { readFile(p: string): Promise<string | undefined>; writeFileAtomic(p: string, text: string): Promise<void>; exists(p: string): Promise<boolean>; realpath(p: string): Promise<string>; appendLineOnce(p: string, line: string): Promise<void> }
/** Rule files are written atomically with mode 0600 (and their folder 0700). */
export const nodePermFs: PermFs = {
  async readFile(p) { try { return await readFile(p, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; } },
  async writeFileAtomic(p, text) { await mkdir(dirname(p), { recursive: true, mode: 0o700 }); const tmp = `${p}.${randomBytes(4).toString('hex')}.tmp`; const fh = await open(tmp, 'w', 0o600); try { await fh.writeFile(text); await fh.sync(); } finally { await fh.close(); } await rename(tmp, p); },
  exists: async (p) => { try { await stat(p); return true; } catch { return false; } },
  realpath: (p) => realpath(p),
  async appendLineOnce(p, line) { const cur = (await nodePermFs.readFile(p)) ?? ''; if (cur.split('\n').some((l) => l.trim() === line)) return; await mkdir(dirname(p), { recursive: true }); await appendFile(p, (cur && !cur.endsWith('\n') ? '\n' : '') + line + '\n'); },
};
