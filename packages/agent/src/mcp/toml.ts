/** Just enough TOML to edit `[mcp_servers.<name>]` tables and leave every other byte alone. */
import type { CodexTable } from './defs.js';

const q = (s: string) => JSON.stringify(s);
const val = (v: string | string[] | Record<string, string>): string => (typeof v === 'string' ? q(v) : Array.isArray(v) ? `[${v.map(q).join(', ')}]` : `{ ${Object.entries(v).map(([k, x]) => `${/^[A-Za-z0-9_-]+$/.test(k) ? k : q(k)} = ${q(x)}`).join(', ')} }`);
export const printTable = (name: string, t: CodexTable, eol = '\n') => [`[mcp_servers.${name}]`, ...t.keys.map(([k, v]) => `${k} = ${val(v)}`)].join(eol) + eol;

const HEADER = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/;
const norm = (h: string) => h.split('.').map((p) => p.trim().replace(/^["']|["']$/g, '')).join('.');
export interface Span { name: string; start: number; end: number }
/** The `[mcp_servers.*]` tables of a file: where each starts and ends, by line index. Lines keep their own endings. */
export function splitLines(text: string): string[] { return text.match(/[^\n]*\n|[^\n]+$/g) ?? []; }
export function findSpans(lines: string[]): { headers: { name: string; line: number }[]; spans: Span[] } {
  const headers = lines.map((l, i) => { const m = HEADER.exec(l.replace(/\r?\n$/, '')); return m ? { name: norm(m[1]!), line: i } : undefined; }).filter((x): x is { name: string; line: number } => !!x);
  const spans = headers.map((h, i) => ({ name: h.name, start: h.line, end: headers[i + 1]?.line ?? lines.length })).filter((s) => s.name.startsWith('mcp_servers.')); return { headers, spans };
}
export const serverOf = (tableName: string) => tableName.split('.')[1]!;
function parseValue(raw: string): string | string[] | Record<string, string> | boolean | number | undefined {
  const s = raw.replace(/\s+#.*$/, '').trim(); if (s.startsWith('"') || s.startsWith("'")) { try { return s.startsWith('"') ? (JSON.parse(s) as string) : s.slice(1, -1); } catch { return undefined; } }
  if (s.startsWith('[')) { try { const j = JSON.parse(s.replace(/'([^']*)'/g, (_m, x) => JSON.stringify(x))); return Array.isArray(j) ? j.map(String) : undefined; } catch { return undefined; } }
  if (s.startsWith('{')) { const o: Record<string, string> = {}; for (const m of s.slice(1, -1).matchAll(/([A-Za-z0-9_"'-]+)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/g)) { const k = m[1]!.replace(/^["']|["']$/g, ''); o[k] = String(parseValue(m[2]!)); } return o; }
  if (s === 'true' || s === 'false') return s === 'true'; if (/^-?\d+$/.test(s)) return Number(s); return undefined;
}
export type CodexRaw = Record<string, string | string[] | Record<string, string> | boolean | number>;
export function parseServers(text: string): Record<string, CodexRaw> {
  const lines = splitLines(text); const { spans } = findSpans(lines); const out: Record<string, CodexRaw> = {};
  for (const sp of spans) { const parts = sp.name.split('.'); const name = parts[1]!; const o = (out[name] ??= {}); const sub = parts.slice(2).join('.');
    for (let i = sp.start + 1; i < sp.end; i++) { const m = /^\s*([A-Za-z0-9_-]+|"[^"]+")\s*=\s*(.*?)\s*$/.exec(lines[i]!.replace(/\r?\n$/, '')); if (!m) continue; const v = parseValue(m[2]!); if (v === undefined) continue; const key = m[1]!.replace(/^"|"$/g, ''); if (sub) { const t = ((o[sub] as Record<string, string>) ??= {}); t[key] = String(v); } else o[key] = v; } }
  return out;
}
/** Replace (or add) one server's tables and remove any sub-tables of it; every other line is untouched. */
export function setServerTable(text: string, name: string, table: string | undefined): string {
  const lines = splitLines(text); const { spans } = findSpans(lines); const mine = spans.filter((s) => serverOf(s.name) === name); const eol = /\r\n/.test(text) ? '\r\n' : '\n'; const fixEol = (t: string) => t.replace(/\r?\n/g, eol);
  if (!mine.length) { if (table === undefined) return text; const sep = text === '' ? '' : text.endsWith('\n') ? (/\r?\n\r?\n$/.test(text) ? '' : eol) : eol + eol; return text + sep + fixEol(table); }
  const first = mine[0]!; const kept = lines.filter((_l, i) => !mine.some((s) => i >= s.start && i < s.end)); const at = lines.slice(0, first.start).filter((_l, i) => !mine.some((s) => i >= s.start && i < s.end)).length;
  // removing the last table also takes the blank line that separated it
  if (table === undefined) { const out = kept.join(''); return mine.at(-1)!.end === lines.length ? out.replace(/(\r?\n){2,}$/, eol) : out; } const tail = mine.at(-1)!; const trailingBlank = lines.slice(first.start, tail.end).reverse().findIndex((l) => l.trim() !== '');
  const block = fixEol(table) + (trailingBlank > 0 && at < kept.length ? eol : ''); return [...kept.slice(0, at), block, ...kept.slice(at)].join('');
}
