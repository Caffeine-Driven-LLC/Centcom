/** Streams an artifact to a file next to the installed program, resuming an interrupted download and never taking more bytes than the release says. */
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { TooLargeError, UpdateError } from './errors.js';

export interface Progress { received: number; total: number }
export interface DownloadOptions { url: string; dest: string; size: number; fetch?: typeof fetch; onProgress?: (p: Progress) => void; signal?: AbortSignal; connectTimeoutMs?: number; idleTimeoutMs?: number }
export const CONNECT_TIMEOUT_MS = 10_000; export const IDLE_TIMEOUT_MS = 60_000;

/** Returns the number of bytes now in `dest` (equal to `size` on success). A partial file is kept for the next try; a file that is too large is deleted. */
export async function downloadArtifact(o: DownloadOptions): Promise<number> {
  const f = o.fetch ?? fetch; let have = existsSync(o.dest) ? statSync(o.dest).size : 0; if (have > o.size) { await rm(o.dest, { force: true }); have = 0; } if (have === o.size) { o.onProgress?.({ received: have, total: o.size }); return have; }
  const ac = new AbortController(); const outer = () => ac.abort(); o.signal?.addEventListener('abort', outer, { once: true });
  let timer = setTimeout(() => ac.abort(), o.connectTimeoutMs ?? CONNECT_TIMEOUT_MS); const idle = () => { clearTimeout(timer); timer = setTimeout(() => ac.abort(), o.idleTimeoutMs ?? IDLE_TIMEOUT_MS); };
  try {
    const res = await f(o.url, { signal: ac.signal, headers: have ? { range: `bytes=${have}-` } : {}, redirect: 'follow' }); idle();
    if (res.status === 416) { await rm(o.dest, { force: true }); throw new UpdateError('range_refused', 'The server could not continue the download; try again.'); }
    if (res.status !== 200 && res.status !== 206) throw new UpdateError('download_failed', `The download failed (HTTP ${res.status}).`);
    if (!res.body) throw new UpdateError('download_failed', 'The download had no content.');
    const resumed = res.status === 206 && have > 0; if (!resumed) have = 0; /* a server that ignores Range sends everything again */
    const out = createWriteStream(o.dest, { flags: resumed ? 'a' : 'w', mode: 0o755 }); let received = have;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        idle(); let c = chunk; if (received + c.length > o.size) { out.destroy(); await rm(o.dest, { force: true }); throw new TooLargeError(); } /* stop at size + 1 byte */
        received += c.length; if (!out.write(c)) await new Promise<void>((r) => out.once('drain', r)); o.onProgress?.({ received, total: o.size });
      }
    } finally { if (!out.destroyed) await new Promise<void>((r) => out.end(r)); }
    if (received < o.size) throw new UpdateError('incomplete', 'The download stopped early; run the command again to continue it.');
    return received;
  } catch (e) { if (e instanceof UpdateError) throw e; throw new UpdateError('download_failed', o.signal?.aborted ? 'The download was cancelled.' : 'The download was interrupted; run the command again to continue it.'); }
  finally { clearTimeout(timer); o.signal?.removeEventListener('abort', outer); }
}
