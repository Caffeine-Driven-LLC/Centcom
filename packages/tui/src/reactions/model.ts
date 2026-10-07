/** Reactions and comments on a message or an agent card (lane C080). Frames are folded by seq, so the order they arrive in does not matter. Comment text only ever comes from `secret` (the decrypted `ct`). */
export type MsgId = string; export type MemberId = string;
export type ReactionCode = 'thumbs' | 'heart' | 'party' | 'laugh' | 'eyes' | 'check';
export const CODES: readonly ReactionCode[] = ['thumbs', 'heart', 'party', 'laugh', 'eyes', 'check'];
export const MAX_PER_MEMBER = 3; export const COMMENT_UI_CAP = 2000; export const UNKNOWN_GLYPH = '•';
/** Pixel-style glyphs, always shown next to a number for screen readers; emoji are not used for display (DESIGN.md 12.7). */
export const GLYPH: Record<ReactionCode, string> = { thumbs: '+1', heart: '<3', party: '*', laugh: ':D', eyes: 'oo', check: '✓' };
export const ANIMATION: Partial<Record<ReactionCode, string>> = { thumbs: 'reaction_thumbs', heart: 'reaction_heart', party: 'reaction_party', laugh: 'reaction_laugh' };
export const glyphOf = (code: string): string => (Object.prototype.hasOwnProperty.call(GLYPH, code) ? GLYPH[code as ReactionCode] : UNKNOWN_GLYPH);
export const isKnown = (code: string): code is ReactionCode => (CODES as readonly string[]).includes(code);

export interface DecodedFrame { k?: string; id?: string; seq?: number; from?: string; ts?: string; p?: Record<string, unknown>; secret?: Record<string, unknown> | null }
export interface ReactionEntry { member: MemberId; target: MsgId; code: string; on: boolean; seq: number }
export interface ReactionState { entries: Readonly<Record<string, ReactionEntry>>; seen: readonly string[] }
export interface ReactionSummary { code: string; count: number; mine: boolean }
export interface CommentView { id: string; member: MemberId; text: string; seq: number; ts: string }
export interface CommentState { byTarget: Readonly<Record<MsgId, readonly CommentView[]>>; seen: readonly string[] }
export const emptyReactions = (): ReactionState => ({ entries: {}, seen: [] }); export const emptyComments = (): CommentState => ({ byTarget: {}, seen: [] });
const SEEN_CAP = 5000; const key = (m: string, t: string, c: string): string => `${m}\u0000${t}\u0000${c}`;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Idempotent and order-free: per (member, target, code) the frame with the highest seq decides; replaying a frame id changes nothing. */
export function reduceReactions(s: ReactionState, f: DecodedFrame): ReactionState {
  if (f?.k !== 'reaction') return s; const target = str(f.p?.target); const code = str(f.p?.code); const op = f.p?.op; const member = str(f.from); const seq = typeof f.seq === 'number' ? f.seq : 0;
  if (!target || !code || !member || (op !== 'add' && op !== 'remove')) return s; if (f.id && s.seen.includes(f.id)) return s;
  const k = key(member, target, code); const cur = s.entries[k]; const seen = f.id ? [...s.seen, f.id].slice(-SEEN_CAP) : s.seen; if (cur && cur.seq > seq) return { ...s, seen };
  return { entries: { ...s.entries, [k]: { member, target, code, on: op === 'add', seq } }, seen };
}
export function reduceComments(s: CommentState, f: DecodedFrame): CommentState {
  if (f?.k !== 'comment.add') return s; const target = str(f.secret?.target); const text = str(f.secret?.text); const id = str(f.id); if (!target || !text || !id || s.seen.includes(id)) return s;
  const list = [...(s.byTarget[target] ?? []), { id, member: str(f.from), text, seq: typeof f.seq === 'number' ? f.seq : 0, ts: str(f.ts) }].sort((a, b) => a.seq - b.seq);
  return { byTarget: { ...s.byTarget, [target]: list }, seen: [...s.seen, id].slice(-SEEN_CAP) };
}
/** Codes on a target with their counts; known codes first in picker order, unknown codes after, each with a count. */
export function summarize(s: ReactionState, target: MsgId, self: MemberId): ReactionSummary[] {
  const by = new Map<string, { n: number; mine: boolean }>(); for (const e of Object.values(s.entries)) if (e.target === target && e.on) { const c = by.get(e.code) ?? { n: 0, mine: false }; c.n++; if (e.member === self) c.mine = true; by.set(e.code, c); }
  const rank = (c: string): number => { const i = (CODES as readonly string[]).indexOf(c); return i < 0 ? 99 : i; };
  return [...by.entries()].map(([code, v]) => ({ code, count: v.n, mine: v.mine })).sort((a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code));
}
export const mineOn = (s: ReactionState, target: MsgId, self: MemberId): string[] => Object.values(s.entries).filter((e) => e.target === target && e.member === self && e.on).map((e) => e.code);
/** `limit` when this would be a fourth distinct reaction by you on the message. */
export function canAdd(s: ReactionState, target: MsgId, self: MemberId, code: string): 'ok' | 'limit' { const mine = mineOn(s, target, self); return mine.includes(code) || mine.length < MAX_PER_MEMBER ? 'ok' : 'limit'; }
