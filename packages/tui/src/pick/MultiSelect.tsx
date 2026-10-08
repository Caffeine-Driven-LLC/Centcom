import React from 'react';
import { Box } from 'ink';
import { Rich, useCol } from '../components/ui.js';
import { sp, truncate } from '../util/text.js';
import type { PickState } from './model.js';

export function MultiSelect({ p, width, height, unicode = true }: { p: PickState; width: number; height: number; unicode?: boolean }) {
  const col = useCol(); const w = Math.min(90, width - 2); const inner = w - 6;
  const room = Math.max(3, height - 7); const start = Math.max(0, Math.min(p.options.length - room, p.sel - Math.floor(room / 2))); const shown = p.options.slice(start, start + room);
  const box = (on: boolean) => (p.multi ? (unicode ? (on ? '◉ ' : '○ ') : on ? '[x] ' : '[ ] ') : unicode ? (on ? '● ' : '○ ') : on ? '(*) ' : '( ) ');
  return (
    <Box width={width} justifyContent="center"><Box flexDirection="column" width={w} borderStyle="round" borderColor={col('accent.primary')} paddingX={2}>
      <Rich line={[sp(truncate(p.title, inner), { c: 'accent.hover', b: true })]} />
      {p.note ? <Rich line={[sp(truncate(p.note, inner), { c: 'text.muted' })]} /> : null}
      <Box height={1} />
      {start > 0 ? <Rich line={[sp(`  ↑ ${start} more`, { c: 'text.muted' })]} /> : null}
      {shown.map((o, i) => {
        const idx = start + i; const on = idx === p.sel; const ticked = p.checked.includes(o.id);
        return <Rich key={o.id} line={[sp(on ? '▸ ' : '  ', { c: 'accent.hover', b: true }), sp(box(ticked), { c: ticked ? 'status.success' : 'text.muted' }), sp(truncate(o.label, Math.floor(inner * 0.55)), { c: on ? 'text.primary' : 'text.secondary', b: on, bg: on ? 'bg.selected' : undefined }), ...(o.hint ? [sp('  ' + truncate(o.hint, Math.floor(inner * 0.4)), { c: 'text.muted' })] : [])]} />;
      })}
      {start + shown.length < p.options.length ? <Rich line={[sp(`  ↓ ${p.options.length - start - shown.length} more`, { c: 'text.muted' })]} /> : null}
      <Box height={1} />
      <Rich line={[sp(p.multi ? `↑↓ move · space tick · a all · enter ${p.confirm} (${p.checked.length}) · esc cancel` : `↑↓ move · enter ${p.confirm} · esc cancel`, { c: 'text.muted' })]} />
    </Box></Box>
  );
}
