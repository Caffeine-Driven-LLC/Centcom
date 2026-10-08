import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, useInput } from 'ink';
import { Rich, useCol } from '../components/ui.js';
import { Clickable } from '../click.js';
import { sp, truncate, type Line } from '../util/text.js';
import { createPaletteEngine, type PaletteProvider, type Section } from './engine.js';
import { flatten, keepSelection, move, selected, type PaletteState } from './nav.js';

export const MAX_ROWS = 8;
export const paletteWidth = (cols: number) => (cols - 4 < 60 ? Math.max(20, cols - 4) : 60);
const GROUP_C = 'text.muted' as const;

/** The overlay itself: grouped results, at most 8 rows with a `▾ N more` row, the typed query and the hints. */
export function PaletteView({ query, sections, sel, cols, loading, onPick }: { query: string; sections: Section[]; sel: number; cols: number; loading?: boolean; /** A click on result `i` (its index in the whole list). */ onPick?: (i: number) => void }) {
  const col = useCol(); const w = paletteWidth(cols); const flat = flatten(sections); const start = Math.min(Math.max(0, sel - MAX_ROWS + 1), Math.max(0, flat.length - MAX_ROWS)); const win = flat.slice(start, start + MAX_ROWS); const more = flat.length - start - win.length;
  const rows: Line[] = []; const rowItem: (number | undefined)[] = []; let lastGroup = ''; const groupOf = new Map<string, { g: string; recent?: boolean }>(); for (const s of sections) for (const it of s.items) groupOf.set(it.id, { g: s.group, recent: s.recent });
  win.forEach((it, k) => {
    const g = groupOf.get(it.id)!; const label = g.recent ? 'Recent' : g.g; if (label !== lastGroup && (k === 0 || groupOf.get(win[k - 1]!.id)!.g !== g.g)) { rows.push([sp(label, { c: GROUP_C, b: true })]); lastGroup = label; }
    const on = start + k === sel; const text = truncate((g.g === 'Commands' && !it.label.startsWith('/') ? '/' : '') + it.label, w - 6); const hit = new Set((it.indices ?? []).map((i) => i + (g.g === 'Commands' && !it.label.startsWith('/') ? 1 : 0)));
    const parts = [...text].map((ch, i) => sp(ch, { c: hit.has(i) ? 'accent.primary' : on ? 'text.primary' : 'text.secondary', b: hit.has(i), bg: on ? 'bg.selected' : undefined }));
    rowItem[rows.length] = start + k; rows.push([sp(on ? '▸ ' : '  ', { c: 'accent.hover', b: true }), ...parts, ...(it.detail && w - 6 - text.length > 6 ? [sp('  ' + truncate(it.detail, w - 10 - text.length), { c: 'text.muted' })] : [])]);
  });
  if (more > 0) rows.push([sp(`  ▾ ${more} more`, { c: 'text.muted' })]);
  if (!flat.length) { if (loading) rows.push([sp('Searching…', { c: 'text.muted' })]); else if (query) { rows.push([sp(`Nothing matches "${truncate(query, w - 24)}".`, { c: 'text.muted' })]); rows.push([sp('Try fewer words or check the spelling.', { c: 'text.muted' })]); } else rows.push([sp('Nothing to show yet.', { c: 'text.muted' })]); }
  return (
    <Box width={cols} justifyContent="center"><Box flexDirection="column" width={w} borderStyle="round" borderColor={col('accent.primary')} paddingX={1}>
      <Rich line={[sp('› ', { c: 'accent.hover', b: true }), sp(query || 'type to search…', { c: query ? 'text.primary' : 'text.muted' })]} />
      {rows.map((r, i) => (rowItem[i] === undefined ? <Rich key={i} line={r} /> : <Clickable key={i} onClick={() => onPick?.(rowItem[i]!)}><Rich line={r} /></Clickable>))}
      <Rich line={[sp('↑↓ move · ⏎ run · esc close', { c: 'text.muted' })]} />
    </Box></Box>
  );
}

/** The live palette: typing searches every provider (debounced), the arrows move, enter runs, esc closes. */
export function CommandPalette({ providers, onClose, cols }: { providers: PaletteProvider[]; onClose: () => void; cols: number }) {
  const engine = useMemo(() => createPaletteEngine({ providers }), [providers]); const [query, setQuery] = useState(''); const [sections, setSections] = useState<Section[]>(engine.sections()); const [st, setSt] = useState<PaletteState>({ query: '', sel: 0 });
  const prev = useRef<Section[]>(sections);
  useEffect(() => { const off = engine.subscribe((s) => { setSt((x) => keepSelection(x, prev.current, s)); prev.current = s; setSections(s); }); engine.setQuery(''); return () => { off(); engine.close(); }; }, [engine]);
  useInput((input, key) => {
    if (key.escape) { onClose(); return; }
    if (key.downArrow) setSt((x) => move(x, sections, 'down')); else if (key.upArrow) setSt((x) => move(x, sections, 'up'));
    else if (key.return) { const it = selected(st, sections); onClose(); if (it) void it.run(); }
    else if (key.backspace || key.delete) { const q = query.slice(0, -1); setQuery(q); setSt({ query: q, sel: 0 }); engine.setQuery(q); }
    else if (input && !key.ctrl && !key.meta) { const q = query + input; setQuery(q); setSt({ query: q, sel: 0 }); engine.setQuery(q); }
  });
  return <PaletteView query={query} sections={sections} sel={st.sel} cols={cols} onPick={(i) => { const it = flatten(sections)[i]; onClose(); if (it) void it.run(); }} />;
}
