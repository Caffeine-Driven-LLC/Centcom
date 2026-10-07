import React from 'react';
import { Box } from 'ink';
import { useTheme, Rich } from '../components/ui.js';
import { HEX_ORDER } from '../cursors/RemoteCursors.js';
import { slotToColour } from '../cursors/model.js';
import { sp, truncate, type Line } from '../util/text.js';
import { MSG } from './messages.js';
import { fileLabel, secondsLeft, type LockView } from './model.js';

export interface WhoIs { name: string; slot: number }
export interface LockViewProps { locks: LockView[]; now: number; /** members by id, for the name and colour of a holder */ member?(id: string): WhoIs | undefined; selfSlot?: number; agentName?(id: string): string | undefined; width?: number }
const when = (l: LockView, now: number): string => { const s = secondsLeft(l.expiresAt, now); return s === undefined ? MSG.held : MSG.secondsLeft(s); };

/** One lock as a line: `! locked src/a.ts · held by Ada · 12s left · B waiting`. */
export function lockLine(l: LockView, o: Pick<LockViewProps, 'now' | 'member' | 'agentName' | 'width'> & { hex?: string }): Line {
  const who = o.member?.(l.holder)?.name ?? MSG.someone; const waiting = l.waiting.map((a) => o.agentName?.(a) ?? MSG.anAgent); const w = o.width ?? 80;
  const parts: Line = [sp(truncate(MSG.locked(fileLabel(l.pathHmac, l.displayPath)), Math.max(8, w - 30)), { c: 'status.warning', b: true }), sp(' · ', { c: 'text.muted' }), sp(MSG.heldBy(who), { c: (o.hex ?? 'text.primary') as never }), sp(' · ' + when(l, o.now), { c: 'text.secondary' })];
  if (waiting.length) parts.push(sp(' · ' + MSG.waiting(waiting.join(', ')), { c: 'text.muted' })); return parts;
}
export function LockChip({ lock, ...o }: Omit<LockViewProps, 'locks'> & { lock: LockView }): React.JSX.Element { return <Rich line={lockLine(lock, { ...o, hex: holderHex(useTheme(), lock, o) })} />; }
function holderHex(theme: ReturnType<typeof useTheme>, l: LockView, o: Pick<LockViewProps, 'member' | 'selfSlot'>): string | undefined {
  if (theme.tier === 'none') return undefined; const m = o.member?.(l.holder); return m ? theme.presence[HEX_ORDER[slotToColour(m.slot, o.selfSlot ?? 0)]] : undefined;
}
/** Every lock, with who holds it, for how long and who waits. Advisory: nothing here blocks editing. */
export function LockInspector({ locks, ...o }: LockViewProps): React.JSX.Element {
  const theme = useTheme(); if (!locks.length) return <Rich line={[sp(MSG.none, { c: 'text.muted' })]} />;
  return <Box flexDirection="column">{locks.map((l) => <Rich key={l.pathHmac} line={lockLine(l, { ...o, hex: holderHex(theme, l, o) })} />)}</Box>;
}
