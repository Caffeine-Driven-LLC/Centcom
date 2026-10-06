import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';

import type { LockFs } from './types.js';

/** Real files. Locks are advisory: nothing here takes an operating-system lock, and no user file is touched, only files inside `.centcom/locks`. */
export const nodeLockFs: LockFs = {
  realpath: (p) => realpath(p),
  async createExclusive(path, text) {
    // O_EXCL: exactly one process can create the file. The content follows a moment later, so a reader that finds an empty file waits and looks again (see the client).
    let fh; try { fh = await open(path, 'wx', 0o600); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false; throw e; }
    try { await fh.writeFile(text); } finally { await fh.close(); } return true;
  },
  async read(p) { try { return await readFile(p, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; } },
  async replace(p, text) { const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`; const fh = await open(tmp, 'wx', 0o600); try { await fh.writeFile(text); await fh.sync(); } finally { await fh.close(); } try { await rename(tmp, p); } catch (e) { await rm(tmp, { force: true }); throw e; } },
  remove: (p) => rm(p, { force: true }),
  mkdirp: async (d) => { await mkdir(d, { recursive: true, mode: 0o700 }); },
  pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } },
};
