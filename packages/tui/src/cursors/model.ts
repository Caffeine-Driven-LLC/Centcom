/** What a remote cursor looks like and when it goes (lane C077, DESIGN.md 3.2, 4.6, 12.2, 16.3). Pure: no Ink, no clock. */
import { truncate, textWidth, sp, type Line } from '../util/text.js';

export type MemberId = string;
export interface CursorState { member: MemberId; path?: string; line?: number; col?: number; selEndLine?: number; selEndCol?: number; updatedAt: number }
export interface CursorRosterEntry { id: MemberId; name: string; slot: number }
export interface Viewport { path: string; firstLine: number; lines: number; cols: number }
export type CursorColour = 'violet' | 'red' | 'yellow' | 'green' | 'brown' | 'violet-outlined';
export const DIM_AFTER_MS = 3000; export const GONE_AFTER_MS = 10_000; export const NAME_CELLS = 12; export const NARROW_COLS = 60;
const OTHERS: readonly CursorColour[] = ['red', 'yellow', 'green', 'brown'];

/** You are violet; the others take red, yellow, green, brown in slot order skipping you; a sixth person gets an outlined violet. */
export function slotToColour(slot: number, selfSlot: number): CursorColour {
  if (slot === selfSlot) return 'violet'; const rank = slot < selfSlot ? slot : slot - 1; return OTHERS[rank] ?? 'violet-outlined';
}
export type Freshness = 'live' | 'dim' | 'gone';
export const freshness = (now: number, updatedAt: number): Freshness => { const age = now - updatedAt; return age >= GONE_AFTER_MS ? 'gone' : age >= DIM_AFTER_MS ? 'dim' : 'live'; };

export interface SelectionSegment { row: number; from: number; to: number }
export interface CursorMark {
  member: MemberId; name: string; initial: string; colour: CursorColour; fresh: 'live' | 'dim';
  /** where the tag goes in the viewport (0-based); an edge marker sits on the first or last row */
  row: number; col: number; edge?: 'up' | 'down'; tag: string; selection: SelectionSegment[];
}
const initialOf = (n: string): string => { const c = [...n.trim()][0]; return c ? c.toUpperCase() : '?'; };
/** `A Ada`, or just `A` in a narrow terminal; the name is cut with an ellipsis at 12 cells. */
export function tagText(name: string, o: { cols: number; edge?: 'up' | 'down'; outlined?: boolean }): string {
  const initial = initialOf(name); const full = o.cols < NARROW_COLS ? initial : `${initial} ${truncate(name, NAME_CELLS)}`; const arrow = o.edge === 'up' ? '↑ ' : o.edge === 'down' ? '↓ ' : '';
  return o.outlined ? `[${arrow}${full}]` : `${arrow}${full}`;
}

/** Everything to draw for the visible file: other people's cursors that are known, current, on this path, with their selections clipped to the viewport. Never throws on odd input. */
export function layoutCursors(p: { cursors: ReadonlyMap<MemberId, CursorState>; roster: readonly CursorRosterEntry[]; viewport: Viewport; selfMember: MemberId; now: number }): CursorMark[] {
  const { viewport: v } = p; const self = p.roster.find((m) => m.id === p.selfMember); const selfSlot = self?.slot ?? 0; const out: CursorMark[] = []; let upAt = 0; let downAt = 0;
  const byId = new Map(p.roster.map((m) => [m.id, m] as const));
  for (const c of p.cursors.values()) {
    if (c.member === p.selfMember) continue; const m = byId.get(c.member); if (!m) continue; /* not in the roster (yet): ignore it */
    if (c.path !== v.path || typeof c.line !== 'number' || !Number.isFinite(c.line)) continue; const fresh = freshness(p.now, c.updatedAt); if (fresh === 'gone') continue;
    const colour = slotToColour(m.slot, selfSlot); const rel = Math.floor(c.line) - v.firstLine; const edge = rel < 0 ? 'up' : rel >= v.lines ? 'down' : undefined;
    const row = edge === 'up' ? 0 : edge === 'down' ? Math.max(0, v.lines - 1) : rel; const tag = tagText(m.name, { cols: v.cols, edge, outlined: colour === 'violet-outlined' });
    let col = edge ? (edge === 'up' ? upAt : downAt) : Math.max(0, Math.min(v.cols - 1, Math.floor(c.col ?? 0))); if (edge) { if (edge === 'up') upAt += textWidth(tag) + 1; else downAt += textWidth(tag) + 1; }
    col = Math.min(col, Math.max(0, v.cols - 1));
    const selection: SelectionSegment[] = [];
    if (typeof c.selEndLine === 'number' && Number.isFinite(c.selEndLine)) {
      const a = Math.floor(c.line); const aCol = Math.max(0, Math.floor(c.col ?? 0)); const b = Math.floor(c.selEndLine); const bCol = Math.max(0, Math.floor(c.selEndCol ?? 0));
      const [l0, c0, l1, c1] = a < b || (a === b && aCol <= bCol) ? [a, aCol, b, bCol] : [b, bCol, a, aCol];
      for (let l = Math.max(l0, v.firstLine); l <= Math.min(l1, v.firstLine + v.lines - 1); l++) { const from = l === l0 ? c0 : 0; const to = l === l1 ? c1 : v.cols; const f = Math.min(from, v.cols); const t = Math.min(Math.max(to, f), v.cols); if (t > f) selection.push({ row: l - v.firstLine, from: f, to: t }); }
    }
    out.push({ member: c.member, name: m.name, initial: initialOf(m.name), colour, fresh, row, col, ...(edge ? { edge } : {}), tag, selection });
  }
  return out;
}

/** The tag as spans: member colour, never colour alone (the initial and name are always there). `hex` is undefined when colour is off: reverse video plus the name. */
export function tagLine(m: CursorMark, o: { hex?: string }): Line {
  const dim = m.fresh === 'dim'; if (o.hex === undefined) return [sp(m.tag, { r: true, d: dim })];
  return [sp(m.tag, { c: o.hex as `#${string}`, r: true, d: dim })];
}
/** Blend two #rrggbb colours: how a selection looks at about 20 % of the member colour on a truecolor terminal. */
export function blend(fg: string, bg: string, alpha: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16); const ch = (i: number) => Math.round(p(fg, i) * alpha + p(bg, i) * (1 - alpha)).toString(16).padStart(2, '0'); return `#${ch(0)}${ch(1)}${ch(2)}`;
}
