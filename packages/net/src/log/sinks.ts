import type { LogRecord, Sink } from './logger.js';

export const noopSink = (): Sink => ({ write() {} });

/** The only place anything may write to process.stderr. Never stdout, and never while the TUI owns the screen. */
export function createStderrSink(stream: { write(s: string): unknown } = process.stderr): Sink { return { write: (line) => { stream.write(line + '\n'); } }; }

export function createRingSink(max = 500): Sink & { snapshot(): LogRecord[] } {
  const buf: LogRecord[] = [];
  return { write(_l, rec) { buf.push(rec); if (buf.length > max) buf.shift(); }, snapshot: () => buf.slice() };
}

/** The file operations the file sink needs, so tests can run without a disk. */
export interface LogFs {
  mkdir(dir: string, mode: number): void; append(path: string, data: string, mode: number): Promise<void>; size(path: string): number; rename(from: string, to: string): void; remove(path: string): void; exists(path: string): boolean;
}

export interface FileSinkOptions { dir: string; maxBytes: number; maxFiles: number; fs: LogFs; file?: string; onUnavailable?: (reason: string) => void }

/** Rotating file sink: centcom.log, centcom.log.1, ... Writes are queued and never block the caller; errors drop records and are counted. */
export function createFileSink(o: FileSinkOptions): Sink {
  const base = `${o.dir}/${o.file ?? 'centcom.log'}`; let size = 0; let ready = false; let dead = false; let dropped = 0; let chain: Promise<void> = Promise.resolve();
  const init = () => { try { o.fs.mkdir(o.dir, 0o700); size = o.fs.exists(base) ? o.fs.size(base) : 0; ready = true; } catch (e) { dead = true; o.onUnavailable?.(String((e as Error).message)); } };
  const rotate = () => {
    if (o.maxFiles <= 1) { o.fs.remove(base); size = 0; return; } // a single file cannot rotate: drop it so the size bound still holds
    for (let i = o.maxFiles - 1; i >= 1; i--) { const from = i === 1 ? base : `${base}.${i - 1}`; const to = `${base}.${i}`; if (o.fs.exists(to) && i === o.maxFiles - 1) o.fs.remove(to); if (o.fs.exists(from)) o.fs.rename(from, to); } size = 0;
  };
  return {
    write(line) {
      if (dead) return; if (!ready) { init(); if (dead) return; }
      const data = line + '\n'; const len = Buffer.byteLength(data);
      chain = chain.then(async () => {
        try {
          if (size > 0 && size + len > o.maxBytes) {
            // another sink or process may have rotated or grown the file since we last looked: trust the disk, not our counter
            try { size = o.fs.exists(base) ? o.fs.size(base) : 0; } catch { /* keep the counter */ }
            if (size > 0 && size + len > o.maxBytes) rotate();
          }
          if (dropped > 0) { const note = JSON.stringify({ ts: new Date().toISOString(), level: 'warn', msg: 'log.dropped', count: dropped }) + '\n'; await o.fs.append(base, note, 0o600); size += Buffer.byteLength(note); dropped = 0; }
          await o.fs.append(base, data, 0o600); size += len;
        } catch { dropped++; } // disk full or unwritable: drop, count, and say so when it works again
      });
    },
    flush: () => chain,
  };
}

import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
export const nodeLogFs: LogFs = {
  mkdir: (dir, mode) => mkdirSync(dir, { recursive: true, mode }),
  append: async (path, data, mode) => { const fresh = !existsSync(path); appendFileSync(path, data, { mode }); if (fresh) { try { chmodSync(path, mode); } catch { /* odd filesystems */ } } },
  size: (p) => statSync(p).size, rename: renameSync, remove: (p) => rmSync(p, { force: true }), exists: existsSync,
};
