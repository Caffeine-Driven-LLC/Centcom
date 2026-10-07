/** Earlier messages for up/down and ctrl+r: `<data>/history.jsonl`, at most 1,000 lines, repeats collapsed, only this project's offered. */
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const MAX_ENTRY = 8 * 1024;
export interface HistoryStore { add(text: string): void; entries(): string[]; search(q: string): string[]; walker(): { up(): string | undefined; down(): string | undefined; reset(): void } }
interface Row { t: string; p: string; at: number }
export function createHistoryStore(d: { path: string; project: string; max?: number; now?: () => number }): HistoryStore {
  const max = d.max ?? 1000; const now = d.now ?? Date.now;
  const read = (): Row[] => { try { return readFileSync(d.path, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { const r = JSON.parse(l) as Row; return typeof r.t === 'string' && typeof r.p === 'string' ? [r] : []; } catch { return []; } }); } catch { return []; } };
  const mine = () => read().filter((r) => r.p === d.project).map((r) => r.t);
  return {
    add(text) {
      const t = text.trim(); if (!t || Buffer.byteLength(t) > MAX_ENTRY) return; const rows = read(); const lastMine = [...rows].reverse().find((r) => r.p === d.project); if (lastMine?.t === t) return; /* the same message twice in a row is one entry */
      try { mkdirSync(dirname(d.path), { recursive: true, mode: 0o700 }); } catch { return; }
      if (rows.length + 1 > max) { const keep = [...rows, { t, p: d.project, at: now() }].slice(-max); const tmp = `${d.path}.tmp`; writeFileSync(tmp, keep.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 }); renameSync(tmp, d.path); }
      else appendFileSync(d.path, JSON.stringify({ t, p: d.project, at: now() }) + '\n', { mode: 0o600 });
    },
    entries: mine,
    search: (q) => { const l = q.toLowerCase(); return mine().filter((t) => t.toLowerCase().includes(l)).reverse(); },
    walker() { let i = -1; return { up() { const e = mine(); if (!e.length) return undefined; i = Math.min(e.length - 1, i + 1); return e[e.length - 1 - i]; }, down() { const e = mine(); if (i <= 0) { i = -1; return undefined; } i--; return e[e.length - 1 - i]; }, reset() { i = -1; } }; },
  };
}
