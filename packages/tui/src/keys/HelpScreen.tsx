import React, { useState } from 'react';
import { Box, useInput } from 'ink';
import { Rich, useCol } from '../components/ui.js';
import { sp, type Line } from '../util/text.js';
import type { ActionDef } from './actions.js';
import { EDITING_KEYS, grouped, helpRows } from './help.js';
import type { Keymap, KeymapWarning } from './keymap.js';

/** `?` help: every action and its live keys, grouped, with a filter line. Two columns from 100 columns wide, or when one column would not fit. Esc closes. */
export function HelpScreen({ actions, keymap, warnings, onClose, width, height }: { actions: ActionDef[]; keymap: Keymap; warnings: KeymapWarning[]; onClose: () => void; width: number; height: number }) {
  const [filter, setFilter] = useState('');
  useInput((input, key) => { if (key.escape) { onClose(); return; } if (key.backspace || key.delete) { setFilter((f) => f.slice(0, -1)); return; } if (input && !key.ctrl && !key.meta && !key.return) setFilter((f) => f + input); });
  return <HelpBody actions={actions} keymap={keymap} warnings={warnings} width={width} height={height} filter={filter} />;
}
export function HelpBody({ actions, keymap, warnings, width, height, filter }: { actions: ActionDef[]; keymap: Keymap; warnings: KeymapWarning[]; width: number; height: number; filter: string }) {
  const col = useCol(); const w = Math.min(width - 2, 118);
  const rowsAll = helpRows(actions, keymap, filter); const kw = Math.min(16, Math.max(6, ...rowsAll.map((r) => (r.keys.join(', ') || '(none)').length), ...EDITING_KEYS.map(([k]) => k.length)));
  const lines: Line[] = []; for (const [g, rows] of grouped(rowsAll)) { lines.push([sp(g, { c: 'text.secondary', b: true })]); for (const r of rows) lines.push([sp((r.keys.join(', ') || '(none)').padEnd(kw).slice(0, kw), { c: 'text.primary', b: true }), sp(' ' + r.description, { c: 'text.secondary' })]); }
  const room = Math.max(3, height - 5 - (warnings.length ? Math.min(3, warnings.length) + 1 : 0));
  const editing: Line[] = [[sp('Editing', { c: 'text.secondary', b: true })], ...EDITING_KEYS.map(([k, d]): Line => [sp(k.padEnd(kw), { c: 'text.primary', b: true }), sp(' ' + d, { c: 'text.secondary' })])];
  if (!filter) { if (Math.ceil((lines.length + editing.length) / 2) <= room) lines.push(...editing); else lines.push([sp('Editing keys: centcom keys', { c: 'text.muted' })]); } /* the prompt's own keys only when there is room */ const twoCols = lines.length > room || (width >= 100 && lines.length > 12); let perCol = twoCols ? Math.ceil(lines.length / 2) : lines.length;
  if (twoCols && lines[perCol - 1]?.length === 1 && lines[perCol - 1]![0]!.b) perCol -= 1; /* a group heading never ends a column */ const colW = twoCols ? Math.floor((w - 4) / 2) : w - 4;
  const cut = (l: Line): Line => { let left = colW; return l.map((s) => { const t = s.t.slice(0, Math.max(0, left)); left -= t.length; return { ...s, t }; }); };
  const colA = lines.slice(0, perCol).map(cut); const colB = twoCols ? lines.slice(perCol).map(cut) : [];
  return (
    <Box width={width} justifyContent="center"><Box flexDirection="column" width={w} borderStyle="round" borderColor={col('accent.primary')} paddingX={1}>
      <Rich line={[sp('Keys', { c: 'accent.hover', b: true }), sp('  type to filter: ', { c: 'text.muted' }), sp(filter || '…', { c: filter ? 'text.primary' : 'text.muted' })]} />
      <Box>
        <Box flexDirection="column" width={colW + 1}>{colA.map((l, i) => <Rich key={i} line={l} />)}</Box>
        {twoCols ? <Box flexDirection="column" width={colW + 1} marginLeft={1}>{colB.map((l, i) => <Rich key={i} line={l} />)}</Box> : null}
      </Box>
      {warnings.slice(0, 3).map((x, i) => <Rich key={`w${i}`} line={[sp('! ' + x.message, { c: 'status.warning' })]} />)}
      <Rich line={[sp('Change keys in keybindings.json in your config folder. Esc closes.', { c: 'text.muted' })]} />
    </Box></Box>
  );
}
