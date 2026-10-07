/** A line diff of two texts, with `context` lines kept around changes. Common start and end are trimmed first; the middle is a longest-common-subsequence. */
import type { DiffFile, DiffLine, Hunk } from './model.js';

export function diffStrings(oldText: string, newText: string, opts: { context?: number; path?: string } = {}): DiffFile {
  const ctx = opts.context ?? 3; const a = oldText === '' ? [] : oldText.split('\n'); const b = newText === '' ? [] : newText.split('\n');
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++; let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const am = a.slice(s, a.length - e); const bm = b.slice(s, b.length - e); const ops: ('=' | '-' | '+')[] = new Array(s).fill('=');
  if (am.length * bm.length <= 4_000_000) { const w = bm.length + 1; const dp = new Uint32Array((am.length + 1) * w); for (let i = am.length - 1; i >= 0; i--) for (let j = bm.length - 1; j >= 0; j--) dp[i * w + j] = am[i] === bm[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!); let i = 0; let j = 0; while (i < am.length || j < bm.length) { if (i < am.length && j < bm.length && am[i] === bm[j]) { ops.push('='); i++; j++; } else if (j < bm.length && (i >= am.length || dp[i * w + j + 1]! > dp[(i + 1) * w + j]!)) { ops.push('+'); j++; } else { ops.push('-'); i++; } } }
  else { for (let i = 0; i < am.length; i++) ops.push('-'); for (let j = 0; j < bm.length; j++) ops.push('+'); } /* too big to align: shown as replaced */
  for (let k = 0; k < e; k++) ops.push('=');
  const lines: DiffLine[] = []; let o = 1; let n = 1; let ai = 0; let bi = 0; let adds = 0; let dels = 0;
  for (const op of ops) { if (op === '=') lines.push({ kind: 'ctx', oldNo: o++, newNo: n++, text: a[ai++]! }), bi++; else if (op === '-') { lines.push({ kind: 'del', oldNo: o++, text: a[ai++]! }); dels++; } else { lines.push({ kind: 'add', newNo: n++, text: b[bi++]! }); adds++; } }
  const keep = new Array<boolean>(lines.length).fill(false); lines.forEach((l, k) => { if (l.kind !== 'ctx') for (let x = Math.max(0, k - ctx); x <= Math.min(lines.length - 1, k + ctx); x++) keep[x] = true; });
  const hunks: Hunk[] = []; let cur: Hunk | undefined; lines.forEach((l, k) => { if (!keep[k]) { cur = undefined; return; } if (!cur) { cur = { oldStart: l.oldNo ?? 0, newStart: l.newNo ?? 0, header: '', lines: [] }; hunks.push(cur); } cur.lines.push(l); });
  return { newPath: opts.path ?? '', status: !a.length ? 'added' : !b.length ? 'deleted' : 'modified', hunks, adds, dels };
}
