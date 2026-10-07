import React from 'react';
import { Box } from 'ink';
import { Rich, useTheme } from '../components/ui.js';
import { sp, type Line } from '../util/text.js';
import { blend, layoutCursors, tagLine, type CursorColour, type CursorRosterEntry, type CursorState, type MemberId, type Viewport } from './model.js';

const HEX_ORDER: Record<CursorColour, number> = { violet: 0, red: 1, yellow: 2, green: 3, brown: 4, 'violet-outlined': 0 };
export interface RemoteCursorsProps { cursors: ReadonlyMap<MemberId, CursorState>; roster: CursorRosterEntry[]; viewport: Viewport; selfMember: MemberId; now: number }

/** Other people's cursors and selections over the visible file. It draws only what changed in the layout and never blocks: the layout is a pure function of the props. */
export function RemoteCursors({ cursors, roster, viewport, selfMember, now }: RemoteCursorsProps): React.JSX.Element {
  const theme = useTheme(); const marks = layoutCursors({ cursors, roster, viewport, selfMember, now }); const colour = theme.tier !== 'none';
  const hex = (c: CursorColour): string | undefined => (colour ? theme.presence[HEX_ORDER[c]] : undefined); const base = theme.c('bg.base');
  const selBg = (c: CursorColour): { bg?: string; r?: boolean; d?: boolean } => { const h = hex(c); return h === undefined ? { r: true, d: true } : theme.tier === 'truecolor' ? { bg: blend(h, base, 0.2) } : { r: true, d: true }; };
  return (
    <Box position="relative" width={viewport.cols} height={viewport.lines}>
      {marks.flatMap((m) => m.selection.map((s, i) => { const o = selBg(m.colour); const line: Line = [sp(' '.repeat(s.to - s.from), { bg: o.bg as never, r: o.r, d: o.d })]; return <Box key={`${m.member}-s${i}`} position="absolute" marginLeft={s.from} marginTop={s.row}><Rich line={line} /></Box>; }))}
      {marks.map((m) => <Box key={m.member} position="absolute" marginLeft={m.col} marginTop={m.row}><Rich line={tagLine(m, { hex: hex(m.colour) })} /></Box>)}
    </Box>
  );
}
