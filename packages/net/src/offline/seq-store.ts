/** Where in each session we were, kept across restarts: the next hello carries it and the relay replays only what came after. One small JSON file per session, replaced atomically. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SeqStore } from '../delivery/seq-store.js';
const safe = (sid: string): string => sid.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
export function createFileSeqStore(dir: string): SeqStore {
  let chain: Promise<void> = Promise.resolve(); const file = (sid: string) => join(dir, `seq-${safe(sid)}.json`);
  return {
    async load(sid) { try { const j = JSON.parse(await readFile(file(sid), 'utf8')) as { seq?: unknown }; return typeof j.seq === 'number' && Number.isInteger(j.seq) && j.seq >= 0 ? j.seq : null; } catch { return null; } },
    save(sid, seq) { const run = async () => { await mkdir(dir, { recursive: true, mode: 0o700 }); const tmp = `${file(sid)}.${process.pid}.tmp`; await writeFile(tmp, JSON.stringify({ seq }), { mode: 0o600 }); await rename(tmp, file(sid)); }; chain = chain.then(run, run); return chain; },
  };
}
