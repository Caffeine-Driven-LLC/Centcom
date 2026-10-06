import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { HttpPost, StateFs } from './telemetry.js';

export const nodeStateFs: StateFs = {
  async read(p) { try { return await readFile(p, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; } },
  async write(p, text) { await mkdir(dirname(p), { recursive: true, mode: 0o700 }); const tmp = `${p}.${randomBytes(4).toString('hex')}.tmp`; const fh = await open(tmp, 'w', 0o600); try { await fh.writeFile(text); await fh.sync(); } finally { await fh.close(); } await rename(tmp, p); },
  remove: (p) => rm(p, { force: true }),
};
/** A POST with a hard time limit, no cookies and no credentials. The response body is never read. */
export const fetchPost: HttpPost = async (url, init) => {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), init.timeoutMs); try { const r = await fetch(url, { method: 'POST', headers: init.headers, body: init.body, signal: ac.signal, credentials: 'omit', redirect: 'error' }); void r.body?.cancel().catch(() => undefined); return { status: r.status }; } finally { clearTimeout(t); }
};
