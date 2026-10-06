import React, { useEffect, useState } from 'react';
import { Box, useInput } from 'ink';
import { Rich } from '../components/ui.js';
import { formatElapsed } from '../util/text.js';
import { sp, truncate, textWidth, type Colour, type Line } from '../util/text.js';
import { stateLabel, type Tone } from './labels.js';
import { sortFleet, type FleetAgent } from './model.js';

const TONE: Record<Tone, Colour> = { work: 'status.info', human: 'status.warning', good: 'status.success', bad: 'status.danger', muted: 'text.muted' };
export const RAIL_WIDTH = 28; export const RAIL_MIN_COLS = 100;
/** `rail` (28 wide, at 100+ columns) or a full-width `overlay`. */
export const modeFor = (cols: number): 'rail' | 'overlay' => (cols >= RAIL_MIN_COLS ? 'rail' : 'overlay');
const SLOT_COLOURS: Colour[] = ['accent.primary', 'status.info', 'status.success', 'status.warning', 'status.danger', 'text.link'];

/** The state word as shown: an approval that is yours says `needs you`, someone else's says `waiting`. */
export function stateWord(a: FleetAgent): { word: string; glyph: string; tone: Tone } {
  const l = stateLabel(a.state); if (a.exit) return a.exit.outcome === 'error' ? { word: a.exit.errorCode ? `error ${a.exit.errorCode}` : 'error', glyph: '✗', tone: 'bad' } : { word: a.exit.outcome === 'ok' ? 'done' : 'stopped', glyph: a.exit.outcome === 'ok' ? '✓' : '○', tone: a.exit.outcome === 'ok' ? 'good' : 'muted' };
  if (a.state === 'awaiting-approval' || a.state === 'asking-question') return a.needsMe ? { word: 'needs you', glyph: '?', tone: 'human' } : { word: 'waiting', glyph: '…', tone: 'muted' }; return l;
}
export function agentRow(a: FleetAgent, o: { width: number; selfMemberId: string; now: number; active?: boolean }): Line {
  const w = stateWord(a); const mine = a.ownerMemberId === o.selfMemberId; const name = a.label ?? a.agentId.slice(0, 8); const owner = mine ? 'you' : `${a.ownerName.slice(0, 1).toUpperCase()} · ${a.ownerName}`; const el = formatElapsed(Math.max(0, o.now - Date.parse(a.since)));
  const rail = o.width <= RAIL_WIDTH + 2; const head = `${w.glyph} ${w.word}`; const bg = o.active ? ('bg.selected' as Colour) : undefined;
  const parts: Line = [sp('● ', { c: SLOT_COLOURS[a.ownerSlot % SLOT_COLOURS.length], bg, r: o.active })];
  if (rail) { const room = Math.max(3, o.width - 2 - head.length - 1); parts.push(sp(truncate(name, room), { c: 'text.primary', bg, r: o.active }), sp(' ' + head, { c: TONE[w.tone], bg, b: w.tone === 'human', r: o.active })); }
  else { const tail = `${head} · ${el}`; const mid = [name, owner, a.branch].filter(Boolean).join(' · '); const room = Math.max(6, o.width - 2 - tail.length - 3); parts.push(sp(truncate(mid, room), { c: 'text.primary', bg, r: o.active }), sp(' · ', { c: 'text.muted', bg, r: o.active }), sp(tail, { c: TONE[w.tone], bg, b: w.tone === 'human', r: o.active })); }
  let used = 0; for (const s of parts) used += textWidth(s.t); if (used > o.width) { const last = parts.pop()!; parts.push(sp(truncate(last.t, Math.max(1, textWidth(last.t) - (used - o.width))), { c: last.c })); } return parts;
}
export function FleetPanel({ agents, selfMemberId, mode, selectedId, onSelect, onClose, now = () => new Date(), width }: { agents: FleetAgent[]; selfMemberId: string; selfSlot?: number; mode: 'rail' | 'overlay'; selectedId?: string; onSelect: (agentId: string) => void; onClose?: () => void; now?: () => Date; width?: number }) {
  const [, tick] = useState(0); const [cur, setCur] = useState(0); const sorted = sortFleet(agents); const w = width ?? (mode === 'rail' ? RAIL_WIDTH : 80);
  useEffect(() => { const h = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(h); }, []); /* elapsed time moves once a second, not with every event */
  useInput((_i, key) => { if (key.downArrow) setCur((c) => Math.min(sorted.length - 1, c + 1)); else if (key.upArrow) setCur((c) => Math.max(0, c - 1)); else if (key.return && sorted[cur]) onSelect(sorted[cur]!.agentId); else if (key.escape && mode === 'overlay') onClose?.(); });
  const active = selectedId ? sorted.findIndex((a) => a.agentId === selectedId) : cur;
  return <Box flexDirection="column" width={w}>{sorted.length ? sorted.map((a, i) => <Rich key={a.agentId} line={agentRow(a, { width: w, selfMemberId, now: now().getTime(), active: i === active })} />) : <Rich line={[sp('No agents yet.', { c: 'text.muted' })]} />}</Box>;
}
