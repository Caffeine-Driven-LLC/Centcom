import React from 'react';
import { Box } from 'ink';
import { Rich, useCol } from '../components/ui.js';
import { Clickable } from '../click.js';
import { sp, truncate } from '../util/text.js';
import type { PickState } from './model.js';

/** How the box is laid out in `height` rows: the same numbers the drawing uses, so a test can check that it fits. Short screens drop the note and the blank rows. */
export function pickLayout(p: PickState, height: number) {
  const compact = height < 16; const note = !compact && !!p.note;
  const fixed = 2 /* borders */ + 1 /* title */ + 1 /* buttons */ + 1 /* hint */ + (compact ? 0 : 2) /* blank rows */ + (note ? 1 : 0);
  const room = Math.max(2, height - fixed - 2 /* room for the two "more" lines */);
  const start = Math.max(0, Math.min(p.options.length - room, p.sel - Math.floor(room / 2))); const shown = p.options.slice(start, start + room);
  const up = start > 0 ? 1 : 0; const down = start + shown.length < p.options.length ? 1 : 0;
  return { compact, note, room, start, shown, rows: fixed + up + down + shown.length };
}
export function MultiSelect({ p, width, height, unicode = true, onRow, onConfirm, onCancel }: { p: PickState; width: number; height: number; unicode?: boolean; /** A click on option `i` (its index in the whole list). */ onRow?: (i: number) => void; onConfirm?: () => void; onCancel?: () => void }) {
  const col = useCol(); const w = Math.min(90, width - 2); const inner = w - 6;
  const L = pickLayout(p, height);
  const { compact, note, start, shown } = L;
  const box = (on: boolean) => (p.multi ? (unicode ? (on ? '◉ ' : '○ ') : on ? '[x] ' : '[ ] ') : unicode ? (on ? '● ' : '○ ') : on ? '(*) ' : '( ) ');
  return (
    <Box width={width} height={height} justifyContent="center" alignItems="center"><Box flexDirection="column" width={w} borderStyle="round" borderColor={col('accent.primary')} paddingX={2}>
      <Rich line={[sp(truncate(p.title, inner), { c: 'accent.hover', b: true })]} />
      {note ? <Rich line={[sp(truncate(p.note ?? '', inner), { c: 'text.muted' })]} /> : null}
      {compact ? null : <Box height={1} />}
      {start > 0 ? <Rich line={[sp(`  ↑ ${start} more`, { c: 'text.muted' })]} /> : null}
      {shown.map((o, i) => {
        const idx = start + i; const on = idx === p.sel; const ticked = p.checked.includes(o.id);
        return <Clickable key={o.id} onClick={() => onRow?.(idx)}><Rich line={[sp(on ? '▸ ' : '  ', { c: 'accent.hover', b: true }), sp(box(ticked), { c: ticked ? 'status.success' : 'text.muted' }), sp((o.key ? `${o.key} ` : '') + truncate(o.label, Math.floor(inner * 0.55)), { c: on ? 'text.primary' : 'text.secondary', b: on, bg: on ? 'bg.selected' : undefined }), ...(o.hint ? [sp('  ' + truncate(o.hint, Math.floor(inner * 0.4)), { c: 'text.muted' })] : [])]} /></Clickable>;
      })}
      {start + shown.length < p.options.length ? <Rich line={[sp(`  ↓ ${p.options.length - start - shown.length} more`, { c: 'text.muted' })]} /> : null}
      {compact ? null : <Box height={1} />}
      <Box>
        <Clickable onClick={() => onConfirm?.()}><Rich line={[sp(` ${unicode ? '✓' : '+'} ${p.confirm}${p.multi ? ` (${p.checked.length})` : ''} `, { c: 'text.primary', b: true, bg: 'bg.selected' })]} /></Clickable>
        <Clickable marginLeft={2} onClick={() => onCancel?.()}><Rich line={[sp(` ${unicode ? '✕' : 'x'} cancel `, { c: 'text.secondary', bg: 'bg.selected' })]} /></Clickable>
      </Box>
      <Rich line={[sp(p.multi ? `↑↓ move · space tick · a all · enter ${p.confirm} (${p.checked.length}) · esc cancel` : `↑↓ move · enter ${p.confirm} · esc cancel`, { c: 'text.muted' })]} />
    </Box></Box>
  );
}
