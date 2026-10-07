import { slotColour, type SlotColour } from './slots.js';
export const DIM_MS = 3000; export const GONE_MS = 10_000;
export interface RemoteCursor { member: string; path?: string; line?: number; col?: number; receivedAt: number }
export interface CursorMark { member: string; name: string; initial: string; colour: SlotColour; opacity: 1 | 0.4; line: number; col: number }
/** Fade and expiry run on the time a frame was received here, never on its own timestamp (clocks differ). Your own cursor is never drawn; someone who left is gone at once. */
export function visibleCursors(cursors: Iterable<RemoteCursor>, o: { me: string; path: string; members: { id: string; name: string; slot: number }[]; now: number }): CursorMark[] {
  const self = o.members.find((m) => m.id === o.me); const out: CursorMark[] = [];
  for (const c of cursors) { if (c.member === o.me) continue; const m = o.members.find((x) => x.id === c.member); if (!m) continue; if (c.path !== o.path || typeof c.line !== 'number') continue; const age = o.now - c.receivedAt; if (age >= GONE_MS) continue; out.push({ member: c.member, name: m.name, initial: [...m.name.trim()][0]?.toUpperCase() ?? '?', colour: slotColour(m.slot, self?.slot ?? 0), opacity: age >= DIM_MS ? 0.4 : 1, line: c.line, col: c.col ?? 0 }); }
  return out;
}
