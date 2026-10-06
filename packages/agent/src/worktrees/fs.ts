import { appendFile, mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface WtFs {
  readFile(p: string): Promise<string | undefined>; writeFileAtomic(p: string, text: string): Promise<void>; mkdirp(p: string): Promise<void>;
  exists(p: string): Promise<boolean>; rmrf(p: string): Promise<void>; realpath(p: string): Promise<string>; appendLineOnce(p: string, line: string): Promise<void>;
}
export const nodeWtFs: WtFs = {
  readFile: async (p) => { try { return await readFile(p, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; } },
  async writeFileAtomic(p, text) { await mkdir(dirname(p), { recursive: true }); const tmp = `${p}.${randomBytes(4).toString('hex')}.tmp`; const fh = await open(tmp, 'w', 0o600); try { await fh.writeFile(text); await fh.sync(); } finally { await fh.close(); } await rename(tmp, p); },
  mkdirp: async (p) => { await mkdir(p, { recursive: true }); },
  exists: async (p) => { try { await stat(p); return true; } catch { return false; } },
  rmrf: (p) => rm(p, { recursive: true, force: true }),
  realpath: (p) => realpath(p),
  async appendLineOnce(p, line) { await mkdir(dirname(p), { recursive: true }); const cur = (await nodeWtFs.readFile(p)) ?? ''; if (cur.split('\n').some((l) => l.trim() === line)) return; await appendFile(p, (cur && !cur.endsWith('\n') ? '\n' : '') + line + '\n'); },
};
