import React from 'react';
import { Box } from 'ink';
import { Rich, useTheme } from '../components/ui.js';
import { sp, type Line } from '../util/text.js';
import type { Theme } from '@centcom/theme';
import { blend, layoutCursors, tagLine, type CursorColour, type CursorMark, type CursorRosterEntry, type CursorState, type MemberId, type Viewport } from './model.js';

const HEX_ORDER: Record<CursorColour, number> = { violet: 0, red: 1, yellow: 2, green: 3, brown: 4, 'violet-outlined': 0 };
export interface Painted { row: number; col: number; line: Line; key: string }
/** Colours for the marks on this theme: a pure step the component and the tier tests share. */
export function paintCursors(marks: CursorMark[], theme: Theme): { selections: Painted[]; tags: Painted[] } {
  const colour = theme.tier !== 'none'; const hex = (c: CursorColour): string | undefined => (colour ? theme.presence[HEX_ORDER[c]] : undefined); const base = theme.c('bg.base');
  const selBg = (c: CursorColour): { bg?: string; r?: boolean; d?: boolean } => { const h = hex(c); return h === undefined ? { r: true, d: true } : theme.tier === 'truecolor' ? { bg: blend(h, base, 0.2) } : { r: true, d: true }; };
  return {
    selections: marks.flatMap((m) => m.selection.map((s, i) => { const o = selBg(m.colour); return { row: s.row, col: s.from, key: `${m.member}-s${i}`, line: [sp(' '.repeat(s.to - s.from), { bg: o.bg as never, r: o.r, d: o.d })] }; })),
    tags: marks.map((m) => ({ row: m.row, col: m.col, key: m.member, line: tagLine(m, { hex: hex(m.colour) }) })),
  };
}
export interface RemoteCursorsProps { cursors: ReadonlyMap<MemberId, CursorState>; roster: CursorRosterEntry[]; viewport: Viewport; selfMember: MemberId; now: number }

/** Other people's cursors and selections over the visible file. It draws only what changed in the layout and never blocks: the layout is a pure function of the props. */
export function RemoteCursors({ cursors, roster, viewport, selfMember, now }: RemoteCursorsProps): React.JSX.Element {
  const theme = useTheme(); const { selections, tags } = paintCursors(layoutCursors({ cursors, roster, viewport, selfMember, now }), theme);
  return (
    <Box position="relative" width={viewport.cols} height={viewport.lines}>
      {selections.map((p) => <Box key={p.key} position="absolute" marginLeft={p.col} marginTop={p.row}><Rich line={p.line} /></Box>)}
      {tags.map((p) => <Box key={p.key} position="absolute" marginLeft={p.col} marginTop={p.row}><Rich line={p.line} /></Box>)}
    </Box>
  );
}
