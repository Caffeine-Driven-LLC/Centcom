/** Reading and writing one session's log files: log.jsonl, then log.1.jsonl, log.2.jsonl… when a segment passes 64 MiB. */
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { HEADER, UnsupportedSessionFormat, type LogRecord } from './format.js';

export const segmentName = (i: number) => (i === 0 ? 'log.jsonl' : `log.${i}.jsonl`);
export function segments(dir: string): string[] {
  if (!existsSync(dir)) return []; const names = new Set(readdirSync(dir)); const out: string[] = [];
  for (let i = 0; names.has(segmentName(i)); i++) out.push(join(dir, segmentName(i))); return out;
}
/** Refuses a session folder that is a symlink (it could point anywhere). */
export function ensureDir(dir: string) {
  if (existsSync(dir)) { if (lstatSync(dir).isSymbolicLink()) throw new Error('A session folder is a symbolic link; refusing to use it.'); return; }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}
/** Reads every segment; a line that is not valid JSON (a write cut short) is skipped. `torn` says whether the very last line was one. */
export function readLog(dir: string, filter?: (line: string) => boolean): { records: LogRecord[]; torn: boolean; bytes: number } {
  const records: LogRecord[] = []; let torn = false; let bytes = 0; const segs = segments(dir);
  segs.forEach((path, si) => {
    const text = readFileSync(path, 'utf8'); bytes = Buffer.byteLength(text); const lines = text.split('\n'); const last = si === segs.length - 1;
    lines.forEach((line, li) => {
      if (!line) return; const isLast = last && li === lines.length - 1; // a complete file ends with "\n", so its last piece is empty
      if (filter && !line.startsWith('{"fmt"') && !filter(line)) return;
      let v: any; try { v = JSON.parse(line); } catch { if (isLast) torn = true; return; }
      if (v && typeof v === 'object' && 'fmt' in v) { if (v.fmt !== HEADER.fmt || v.v !== HEADER.v) throw new UnsupportedSessionFormat(`${String(v.fmt)} v${String(v.v)}`); return; }
      if (v && typeof v.n === 'number' && typeof v.type === 'string') records.push(v as LogRecord);
    });
  });
  return { records, torn, bytes };
}
/** Appends lines to a segment file, creating it (0600, with the header) when new. Returns its new size. */
export function appendLines(path: string, lines: string[]): number {
  if (!existsSync(path)) { const fd = openSync(path, 'wx', 0o600); try { writeSync(fd, JSON.stringify(HEADER) + '\n'); } finally { closeSync(fd); } }
  if (lines.length) appendFileSync(path, lines.join(''), { mode: 0o600 });
  return statSync(path).size;
}
