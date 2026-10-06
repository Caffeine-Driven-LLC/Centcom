/** The header and footer lines: which fields exist, what they say, and what is dropped first when the terminal gets narrow. */
import { textWidth } from '../util/text.js';

export type StatusFieldName = 'cwd' | 'branch' | 'mode' | 'agents' | 'online' | 'cost' | 'quota' | 'role' | 'connectivity' | 'hints';
export interface StatusFields { cwd: string; home?: string; branch?: string; mode?: 'ask' | 'accept-edits' | 'plan'; agents?: number; online?: number; costMicroUsd?: number; showCost?: boolean; quota?: { used: number; limit: number | null; warnPct?: number }; role?: 'host' | 'editor' | 'viewer'; connectivity?: 'online' | 'offline' | 'reconnecting'; hints?: string[] }
export type Tone = 'muted' | 'warning' | 'danger';
export interface StatusSegment { field: StatusFieldName; text: string; tone: Tone; side: 'left' | 'right' }
/** What goes first when the line is too wide. The mode goes last; quota, role and connectivity are never dropped. */
export const STATUS_DROP_ORDER: StatusFieldName[] = ['hints', 'cost', 'online', 'agents', 'branch', 'mode'];
export const SEP = ' · ';
export const MAX_BRANCH = 24;

export const formatCost = (micro: number): string => '$' + (Math.max(0, micro) / 1_000_000).toFixed(2);
/** `agent/feature-r…`: a long branch name keeps its beginning and says it was cut. */
export const shortBranch = (b: string): string => ([...b].length > MAX_BRANCH ? [...b].slice(0, 15).join('') + '…' : b);
/** `~/code/app`, or the last two folders with a leading `…/` when that is still long. */
export function shortCwd(cwd: string, home?: string): string {
  let p = home && (cwd === home || cwd.startsWith(home + '/')) ? '~' + cwd.slice(home.length) : cwd; if (textWidth(p) <= 24) return p;
  const parts = p.split('/').filter(Boolean); p = '…/' + parts.slice(-2).join('/'); return textWidth(p) <= 24 ? p : '…/' + (parts.at(-1) ?? '').slice(-20);
}
export function quotaChip(q: StatusFields['quota']): { text: string; tone: Tone } | undefined {
  if (!q || q.limit === null || q.limit <= 0) return undefined; const pct = Math.round((q.used / q.limit) * 100); const warn = q.warnPct ?? 80;
  if (pct >= 100) return { text: 'quota 100%', tone: 'danger' }; return pct >= warn ? { text: `quota ${pct}%`, tone: 'warning' } : undefined;
}
const MODE_TEXT = { ask: '⏵ ask before edits', 'accept-edits': '⏵⏵ accept edits on', plan: '⏸ plan mode' } as const;
const ROLE = { host: 'HOST', editor: 'EDIT', viewer: 'VIEW' } as const;

function build(f: StatusFields, line: 'header' | 'footer'): StatusSegment[] {
  const seg = (field: StatusFieldName, text: string, side: 'left' | 'right', tone: Tone = 'muted'): StatusSegment => ({ field, text, tone, side }); const out: StatusSegment[] = [];
  if (line === 'header') {
    out.push(seg('cwd', `cento${SEP}${shortCwd(f.cwd, f.home)}`, 'left')); if (f.branch) out.push(seg('branch', shortBranch(f.branch), 'left'));
    if (f.agents !== undefined) out.push(seg('agents', `● ${f.agents} agent${f.agents === 1 ? '' : 's'}`, 'right')); if (f.online !== undefined) out.push(seg('online', `☻ ${f.online} online`, 'right'));
    if (f.costMicroUsd !== undefined && f.showCost !== false) out.push(seg('cost', formatCost(f.costMicroUsd), 'right'));
    const q = quotaChip(f.quota); if (q) out.push(seg('quota', q.text, 'right', q.tone)); if (f.role) out.push(seg('role', ROLE[f.role], 'right')); if (f.connectivity && f.connectivity !== 'online') out.push(seg('connectivity', f.connectivity, 'right', 'warning'));
  } else {
    if (f.mode) out.push(seg('mode', MODE_TEXT[f.mode], 'left')); if (f.branch) out.push(seg('branch', shortBranch(f.branch), 'left')); for (const h of f.hints ?? []) out.push(seg('hints', h, 'right'));
  }
  return out;
}
const widthOf = (s: StatusSegment[]) => { const l = s.filter((x) => x.side === 'left').map((x) => x.text).join(SEP); const r = s.filter((x) => x.side === 'right').map((x) => x.text).join(SEP); return textWidth(l) + textWidth(r) + (l && r ? 2 : 0); };

/** The segments that fit in `width` columns, dropping fields in `dropOrder` until they do. Left and right parts are joined with at least two spaces. */
export function layoutStatus(fields: StatusFields, width: number, dropOrder: StatusFieldName[] = STATUS_DROP_ORDER, line: 'header' | 'footer' = 'header'): StatusSegment[] {
  let segs = build(fields, line);
  for (const name of dropOrder) { if (widthOf(segs) <= width) break; segs = segs.filter((s) => s.field !== name); }
  if (widthOf(segs) > width) { segs = segs.map((s) => (s.field === 'cwd' ? { ...s, text: `cento${SEP}…` } : s)); }
  /* still too wide (a tiny terminal): the right part goes, then the left is cut */
  if (widthOf(segs) > width) segs = segs.filter((s) => s.side === 'left');
  return segs;
}
/** The line as a string: left part, spaces, right part, exactly `width` columns or fewer. */
export function renderStatus(segs: StatusSegment[], width: number): string {
  const l = segs.filter((x) => x.side === 'left').map((x) => x.text).join(SEP); const r = segs.filter((x) => x.side === 'right').map((x) => x.text).join(SEP);
  let line = l + ' '.repeat(Math.max(2, width - textWidth(l) - textWidth(r))) + r; if (!r) line = l;
  if (textWidth(line) > width) { let o = ''; for (const ch of line) { if (textWidth(o + ch) > width - 1) break; o += ch; } line = o + '…'; } return line;
}
/** One sentence for a screen reader: no glyphs, under 120 characters. */
export function statusText(f: StatusFields): string {
  const p: string[] = [`Cento in ${shortCwd(f.cwd, f.home).replace(/^~/, 'home')}`]; if (f.branch) p[0] += ` on ${shortBranch(f.branch)}`;
  if (f.mode) p.push(f.mode === 'accept-edits' ? 'accept edits on' : f.mode === 'plan' ? 'plan mode' : 'asking before edits');
  if (f.agents !== undefined) p.push(`${f.agents} agent${f.agents === 1 ? '' : 's'}`); if (f.online !== undefined) p.push(`${f.online} online`);
  if (f.costMicroUsd !== undefined && f.showCost !== false) { const c = f.costMicroUsd / 1_000_000; p.push(c < 1 ? `cost ${Math.round(c * 100)} cents` : `cost $${c.toFixed(2)}`); }
  const q = quotaChip(f.quota); if (q) p.push(q.text); if (f.role) p.push(`${f.role} role`); if (f.connectivity && f.connectivity !== 'online') p.push(f.connectivity);
  return p.join(', ') + '.';
}
