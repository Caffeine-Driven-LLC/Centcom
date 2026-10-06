/** The rows a diff shows: file headers, hunks with collapsed gaps, numbered lines with word highlights, caps. Pure, so layout is testable. */
import { cellWidth, sp, type Colour, type Line, type Span } from '../util/text.js';
import { MAX_FILES, MAX_LINES, type DiffFile, type DiffLine } from './model.js';
import { moreFiles } from './parse.js';
import { wordRanges, type Range } from './words.js';

export const GUTTER = 7; export const GAP_MIN = 6; export const CONTEXT = 3;
export type DiffRowKind = 'file' | 'line' | 'gap' | 'more' | 'note';
export interface RowMeta { kind: DiffRowKind; /** For a gap: its id (`file:hunk:index`), what `⏎` toggles. */ gapId?: string }
export interface Rendered { line: Line; meta: RowMeta }

/** Cuts text to rows of `room` columns (wide characters count 2). */
function chunks(text: string, room: number): string[] { const out: string[] = []; let cur = ''; let w = 0; for (const ch of text) { const c = cellWidth(ch); if (w + c > room && cur) { out.push(cur); cur = ''; w = 0; } cur += ch; w += c; } out.push(cur); return out; }
function styled(text: string, ranges: Range[] | undefined, base: Omit<Span, 't'>, hot: Omit<Span, 't'>): Span[] {
  if (!ranges?.length) return [{ t: text, ...base }]; const out: Span[] = []; let at = 0; for (const [s, e] of ranges) { if (s > at) out.push({ t: text.slice(at, s), ...base }); out.push({ t: text.slice(s, e), ...hot }); at = e; } if (at < text.length) out.push({ t: text.slice(at), ...base }); return out;
}
const num = (n: number | undefined) => (n === undefined ? '     ' : String(n).padStart(5));

export function statusLabel(f: DiffFile): string {
  if (f.status === 'binary') return 'Binary file changed'; if (f.status === 'renamed' && !f.hunks.length) return `${f.oldPath ?? '?'} → ${f.newPath}`; return `${f.status === 'renamed' ? `${f.oldPath ?? '?'} → ` : ''}${f.newPath}`;
}
/** Split a hunk's lines into runs, pairing each block of removals with the added block that follows, for word highlights. */
function pairs(lines: DiffLine[]): Map<number, { old?: Range[]; new?: Range[] }> {
  const m = new Map<number, { old?: Range[]; new?: Range[] }>(); let i = 0;
  while (i < lines.length) { if (lines[i]!.kind !== 'del') { i++; continue; } let d = i; while (d < lines.length && lines[d]!.kind === 'del') d++; let a = d; while (a < lines.length && lines[a]!.kind === 'add') a++; const n = Math.min(d - i, a - d); for (let k = 0; k < n; k++) { const r = wordRanges(lines[i + k]!.text, lines[d + k]!.text); if (r) { m.set(i + k, { old: r.old }); m.set(d + k, { new: r.new }); } } i = a; }
  return m;
}
export function renderDiffRows(files: DiffFile[], o: { width: number; expanded?: ReadonlySet<string>; unicode?: boolean; maxFiles?: number; maxLines?: number }): Rendered[] {
  const out: Rendered[] = []; const width = Math.max(20, o.width); const room = width - GUTTER; const maxFiles = o.maxFiles ?? MAX_FILES; const maxLines = o.maxLines ?? MAX_LINES; let budget = maxLines;
  const add = (line: Line, meta: RowMeta) => out.push({ line, meta });
  files.slice(0, maxFiles).forEach((f, fi) => {
    add([sp(f.status === 'binary' ? `${f.newPath}  Binary file changed` : statusLabel(f), { c: 'text.link', b: true }), ...(f.status === 'binary' ? [] : [sp(`  +${f.adds} −${f.dels}`, { c: 'text.muted' })])], { kind: 'file' });
    f.hunks.forEach((h, hi) => {
      const pr = pairs(h.lines); let k = 0; const ctxRun = (from: number) => { let e = from; while (e < h.lines.length && h.lines[e]!.kind === 'ctx') e++; return e; };
      while (k < h.lines.length) {
        const l = h.lines[k]!;
        if (l.kind === 'ctx') { const e = ctxRun(k); const run = e - k; const first = k === 0; const last = e === h.lines.length; const id = `${fi}:${hi}:${k}`;
          /* a long unchanged stretch keeps 3 lines next to each change and folds the rest */
          if (run > GAP_MIN && !(o.expanded?.has(id)) && !(first && last)) { const headKeep = first ? 0 : CONTEXT; const tailKeep = last ? 0 : CONTEXT; const hidden = run - headKeep - tailKeep; if (hidden > 0) { for (let x = 0; x < headKeep; x++) emit(h.lines[k + x]!, undefined, add); add([sp(`      ⋯ ${hidden} unchanged line${hidden === 1 ? '' : 's'}`, { c: 'text.muted' })], { kind: 'gap', gapId: id }); for (let x = e - tailKeep; x < e; x++) emit(h.lines[x]!, undefined, add); k = e; continue; } }
          for (let x = k; x < e; x++) { if (budget-- <= 0) break; emit(h.lines[x]!, undefined, add); } k = e; continue; }
        if (budget-- <= 0) { k++; continue; } emit(l, pr.get(k), add); k++;
      }
    });
    if (f.moreLines) add([sp(`      ⋯ ${f.moreLines.toLocaleString('en-US')} more lines`, { c: 'text.muted' })], { kind: 'more' });
  });
  const extra = Math.max(0, files.length - maxFiles) + moreFiles(files); if (extra) add([sp(`⋯ ${extra} more files`, { c: 'text.muted' })], { kind: 'more' });
  return out;
  function emit(l: DiffLine, w: { old?: Range[]; new?: Range[] } | undefined, push: (line: Line, m: RowMeta) => void) {
    const sign = l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '; const base: Omit<Span, 't'> = l.kind === 'add' ? { c: 'status.success', bg: 'status.success.subtle' } : l.kind === 'del' ? { c: 'status.danger', bg: 'status.danger.subtle' } : { c: 'text.secondary' };
    const hot: Omit<Span, 't'> = { ...base, b: true, r: true }; const parts = chunks(l.text.replace(/\t/g, '  '), room); const ranges = l.kind === 'add' ? w?.new : l.kind === 'del' ? w?.old : undefined; let at = 0;
    parts.forEach((p, pi) => { const rs = ranges?.map(([s, e]): Range => [Math.max(0, s - at), Math.min(p.length, e - at)]).filter(([s, e]) => e > s); push([sp(pi === 0 ? num(l.kind === 'add' ? l.newNo : l.oldNo ?? l.newNo) + ' ' : '      ', { c: 'text.muted' }), sp(pi === 0 ? sign : ' ', { ...base, b: l.kind !== 'ctx' }), ...styled(p, rs, base, hot)], { kind: 'line' }); at += p.length; });
  }
}
export type { Colour };
