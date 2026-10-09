/** Unified diff parsing and rendering (lane C037): added/removed lines with tinted backgrounds, line numbers, context. */
import { sp, truncate, type Line } from './text.js';

export interface DiffRow { kind: 'file' | 'hunk' | 'add' | 'del' | 'ctx' | 'note'; text: string; oldNo?: number; newNo?: number }

export function parseDiff(diff: string): DiffRow[] {
  const rows: DiffRow[] = []; let o = 0, n = 0;
  for (const l of diff.replace(/\n$/, '').split('\n')) {
    if (l.startsWith('+++ ')) { rows.push({ kind: 'file', text: l.slice(4).replace(/^b\//, '') }); continue; }
    if (l.startsWith('--- ')) continue;
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@\s?(.*)$/.exec(l);
    if (h) { o = Number(h[1]); n = Number(h[2]); rows.push({ kind: 'hunk', text: h[3] || '' }); continue; }
    if (l.startsWith('\\')) { rows.push({ kind: 'note', text: l.replace(/^\\\s?/, '') }); continue; } // "\ No newline at end of file": a note about the line above, not a line
    if (l.startsWith('+')) rows.push({ kind: 'add', text: l.slice(1), newNo: n++ });
    else if (l.startsWith('-')) rows.push({ kind: 'del', text: l.slice(1), oldNo: o++ });
    else rows.push({ kind: 'ctx', text: l.startsWith(' ') ? l.slice(1) : l, oldNo: o++, newNo: n++ });
  }
  return rows;
}

export function diffStats(rows: DiffRow[]): { add: number; del: number } {
  return { add: rows.filter((r) => r.kind === 'add').length, del: rows.filter((r) => r.kind === 'del').length };
}

/** Render parsed rows as Lines of exactly `width` cells (so tinted backgrounds fill the row). */
export function renderDiff(diff: string, width: number, maxRows = 14): Line[] {
  const rows = parseDiff(diff); const out: Line[] = [];
  const numW = String(Math.max(1, ...rows.map((r) => r.newNo ?? r.oldNo ?? 0))).length;
  const shown = rows.slice(0, maxRows);
  for (const r of shown) {
    if (r.kind === 'file') { out.push([sp(truncate(r.text, width), { c: 'text.link', b: true })]); continue; }
    if (r.kind === 'note') { out.push([sp(truncate('\\ ' + r.text, width), { c: 'text.muted', d: true })]); continue; }
    if (r.kind === 'hunk') { out.push([sp(truncate('⋯ ' + r.text, width), { c: 'text.muted', d: true })]); continue; }
    const no = String(r.kind === 'del' ? r.oldNo : r.newNo).padStart(numW);
    const sign = r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' ';
    const body = truncate(r.text.replace(/\t/g, '  '), Math.max(1, width - numW - 4));
    const pad = ' '.repeat(Math.max(0, width - numW - 4 - [...body].length));
    const bg = r.kind === 'add' ? 'status.success.subtle' : r.kind === 'del' ? 'status.danger.subtle' : undefined;
    const fg = r.kind === 'add' ? 'status.success' : r.kind === 'del' ? 'status.danger' : 'text.secondary';
    out.push([sp(no + ' ', { c: 'text.muted', bg }), sp(sign + ' ', { c: fg, b: true, bg }), sp(body + pad + ' ', { c: fg, bg })]);
  }
  if (rows.length > shown.length) out.push([sp(`⋯ ${rows.length - shown.length} more lines`, { c: 'text.muted', d: true })]);
  return out;
}
