import { chmod, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { McpFs } from './manager.js';

/** Real files: written through a temp file and a rename, an existing file keeps its permissions (a new one is 0644, a new folder 0755). */
export const nodeMcpFs: McpFs = {
  async read(p) { try { return await readFile(p, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; } },
  async writeAtomic(p, text) {
    const mode = await stat(p).then((s) => s.mode & 0o777, () => 0o644); await mkdir(dirname(p), { recursive: true }); const tmp = `${p}.${randomBytes(4).toString('hex')}.tmp`;
    try { const fh = await open(tmp, 'w', 0o600); try { await fh.writeFile(text); await fh.sync(); } finally { await fh.close(); } await chmod(tmp, mode); await rename(tmp, p); } catch (e) { await rm(tmp, { force: true }); throw e; }
  },
};
