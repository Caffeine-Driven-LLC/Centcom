/** What the host keeps beyond the server's memory: every numbered frame appended to disk, and a snapshot every 500 frames or 5 minutes of activity (the latest 3 stay). */
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Frame } from '@centcom/protocol';
export type SequencedFrame = Frame & { seq: number };
export interface SessionPersistence {
  appendFrame(sid: string, f: SequencedFrame): Promise<void>; readFrames(sid: string, afterSeq: number, limit: number): AsyncIterable<SequencedFrame>;
  saveSnapshot(sid: string, s: { seq: number; bytes: Uint8Array }): Promise<void>; latestSnapshot(sid: string): Promise<{ seq: number; bytes: Uint8Array } | null>;
}
export const SNAPSHOT_FRAMES = 500; export const SNAPSHOT_MS = 5 * 60_000; export const KEEP_SNAPSHOTS = 3;
/** A directory per session: `frames.jsonl` and `snapshot-<seq>.bin` (mode 0600), the oldest snapshots removed beyond the latest 3. */
export function createFilePersistence(root: string, o: { keep?: number } = {}): SessionPersistence {
  const dir = (sid: string) => join(root, sid.replace(/[^A-Za-z0-9_-]/g, '_')); let chain: Promise<unknown> = Promise.resolve(); const serial = <T>(f: () => Promise<T>): Promise<T> => { const r = chain.then(f, f); chain = r.catch(() => undefined); return r; };
  return {
    appendFrame: (sid, f) => serial(async () => { await mkdir(dir(sid), { recursive: true, mode: 0o700 }); await appendFile(join(dir(sid), 'frames.jsonl'), JSON.stringify(f) + '\n', { mode: 0o600 }); }),
    async *readFrames(sid, afterSeq, limit) { let text = ''; try { text = await readFile(join(dir(sid), 'frames.jsonl'), 'utf8'); } catch { return; } let n = 0; for (const l of text.split('\n')) { if (!l) continue; let f: SequencedFrame; try { f = JSON.parse(l) as SequencedFrame; } catch { continue; } if (f.seq > afterSeq) { yield f; if (++n >= limit) return; } } },
    saveSnapshot: (sid, s) => serial(async () => { await mkdir(dir(sid), { recursive: true, mode: 0o700 }); const path = join(dir(sid), `snapshot-${String(s.seq).padStart(12, '0')}.bin`); const tmp = `${path}.tmp`; await writeFile(tmp, s.bytes, { mode: 0o600 }); await rename(tmp, path); const files = (await readdir(dir(sid))).filter((x) => /^snapshot-\d+\.bin$/.test(x)).sort(); for (const old of files.slice(0, Math.max(0, files.length - (o.keep ?? KEEP_SNAPSHOTS)))) await rm(join(dir(sid), old), { force: true }); }),
    async latestSnapshot(sid) { try { const files = (await readdir(dir(sid))).filter((x) => /^snapshot-\d+\.bin$/.test(x)).sort(); const last = files.at(-1); if (!last) return null; return { seq: Number(/\d+/.exec(last)![0]), bytes: new Uint8Array(await readFile(join(dir(sid), last))) }; } catch { return null; } },
  };
}
export const listSnapshots = async (root: string, sid: string): Promise<string[]> => { try { return (await readdir(join(root, sid.replace(/[^A-Za-z0-9_-]/g, '_')))).filter((x) => /^snapshot-\d+\.bin$/.test(x)).sort(); } catch { return []; } };
