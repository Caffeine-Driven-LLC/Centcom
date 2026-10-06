import { emptyText } from '../onboarding/copy.js';
import React, { useEffect, useMemo, useState } from 'react';
import { Box } from 'ink';
import { bakedByCategory, bakedCategories, bakedNames, getBaked, recolorBaked, CENTO_COLORS, type BakedAnimation } from '@centcom/mascot';
import { PixelView, Rich, useCol, useTheme } from './ui.js';
import { CLAUDE_MODELS } from '@centcom/agent';
import { COMMANDS } from '../state/commands.js';
import { sp, truncate, type Line } from '../util/text.js';

/* --------------------------------------------------------------- palette */
export interface PaletteItem { id: string; label: string; hint: string; run: string }
export function paletteItems(query: string): PaletteItem[] {
  const q = query.toLowerCase().trim();
  const cmds: PaletteItem[] = COMMANDS.map((c) => ({ id: 'c:' + c.name, label: '/' + c.name + (c.args ? ' ' + c.args : ''), hint: c.desc, run: '/' + c.name }));
  const anims: PaletteItem[] = q.length >= 2 ? bakedNames().filter((n) => n.includes(q.replace(/\s+/g, '_'))).slice(0, 40).map((n) => ({ id: 'a:' + n, label: 'cento ' + n, hint: getBaked(n)?.desc ?? '', run: '/cento ' + n })) : [];
  const extra: PaletteItem[] = [
    { id: 'x:dark', label: 'Theme: Graphite (dark)', hint: 'default', run: '/theme dark' }, { id: 'x:light', label: 'Theme: Paper (light)', hint: 'for light terminals', run: '/theme light' },
    { id: 'x:plan', label: 'Mode: plan (read-only)', hint: 'nothing is changed', run: '/mode plan' }, { id: 'x:accept', label: 'Mode: accept edits', hint: 'edits go through, commands ask', run: '/mode acceptEdits' }, { id: 'x:ask', label: 'Mode: ask first', hint: 'default', run: '/mode default' },
    ...CENTO_COLORS.map((c) => ({ id: 'col:' + c, label: 'Cento colour: ' + c, hint: '', run: '/color ' + c })),
  ];
  const all = [...cmds, ...extra, ...anims];
  if (!q) return all.slice(0, 12);
  return all.filter((i) => (i.label + ' ' + i.hint).toLowerCase().includes(q)).slice(0, 10);
}

export function Palette({ query, sel, width }: { query: string; sel: number; width: number }) {
  const col = useCol();
  const items = paletteItems(query); const w = Math.min(76, width - 4);
  return (
    <Box width={width} justifyContent="center"><Box flexDirection="column" width={w} borderStyle="round" borderColor={col('accent.primary')} paddingX={1}>
      <Rich line={[sp('› ', { c: 'accent.hover', b: true }), sp(query, { c: 'text.primary' }), sp('▏', { c: 'signal' }), ...(query ? [] : [sp('type to filter commands and animations', { c: 'text.muted' })])]} />
      <Box height={1} />
      {items.length === 0 ? <Rich line={[sp(emptyText('no-results', query), { c: 'text.muted' })]} /> : items.map((it, i) => {
        const on = i === sel % items.length;
        return <Rich key={it.id} line={[sp(on ? '▸ ' : '  ', { c: 'accent.hover', b: true }), sp(truncate(it.label, 36), { c: on ? 'text.primary' : 'text.secondary', b: on, bg: on ? 'bg.selected' : undefined }), sp('  ' + truncate(it.hint, w - 46), { c: 'text.muted' })]} />;
      })}
      <Box height={1} />
      <Rich line={[sp('↑↓ move · enter run · esc close', { c: 'text.muted' })]} />
    </Box></Box>
  );
}

/* --------------------------------------------------------------- help */
const KEYS: [string, string][] = [
  ['Enter', 'send'], ['ctrl+j  or  \\ Enter', 'new line'], ['Esc', 'interrupt the agent / close'], ['ctrl+c', 'interrupt; twice to quit'],
  ['shift+tab', 'cycle permission mode'], ['ctrl+k', 'command palette'], ['ctrl+o', 'choose the model'], ['ctrl+t', 'show or hide the fleet'], ['?', 'this help (empty prompt)'],
  ['PageUp / PageDown', 'scroll the transcript'], ['shift+↑ / shift+↓', 'scroll 3 lines'], ['End', 'jump to the latest'], ['↑ / ↓', 'prompt history'],
  ['ctrl+a / ctrl+e', 'line start / end'], ['ctrl+w', 'delete word'], ['ctrl+u', 'delete to line start'], ['alt+b / alt+f', 'word left / right'],
];
export function Help({ width }: { width: number }) {
  const col = useCol(); const w = Math.min(78, width - 4);
  return (
    <Box width={width} justifyContent="center"><Box flexDirection="column" width={w} borderStyle="round" borderColor={col('accent.primary')} paddingX={2}>
      <Rich line={[sp('Keys', { c: 'accent.hover', b: true })]} /><Box height={1} />
      {KEYS.map(([k, d]) => <Rich key={k} line={[sp(k.padEnd(22), { c: 'text.primary', b: true }), sp(d, { c: 'text.secondary' })]} />)}
      <Box height={1} /><Rich line={[sp('Permission modes: ', { c: 'text.muted' }), sp('ask first', { c: 'accent.hover' }), sp(' → ', { c: 'text.muted' }), sp('accept edits', { c: 'status.warning' }), sp(' → ', { c: 'text.muted' }), sp('plan', { c: 'status.info' })]} />
      <Rich line={[sp('Type / for commands. Press any key to close.', { c: 'text.muted' })]} />
    </Box></Box>
  );
}

/* --------------------------------------------------------------- gallery */
export function galleryList(cat: number): BakedAnimation[] { const c = bakedCategories(); return bakedByCategory(c[((cat % c.length) + c.length) % c.length]!); }

export function Gallery({ cat, idx, color, width, height, reduced }: { cat: number; idx: number; color: number; width: number; height: number; reduced: boolean }) {
  const theme = useTheme(); const col = useCol();
  const cats = bakedCategories(); const catName = cats[((cat % cats.length) + cats.length) % cats.length]!;
  const list = galleryList(cat); const a0 = list[((idx % list.length) + list.length) % list.length]!;
  const me = CENTO_COLORS[color % CENTO_COLORS.length]!;
  const a = useMemo(() => recolorBaked(a0, me, CENTO_COLORS[(color + 1) % CENTO_COLORS.length]!), [a0, me, color]);
  const [fi, setFi] = useState(0);
  useEffect(() => {
    setFi(0); if (reduced) return;
    let i = 0; let t: NodeJS.Timeout;
    const step = () => { i = (i + 1) % a.frames.length; setFi(i); t = setTimeout(step, a.frames[i]!.d); };
    t = setTimeout(step, a.frames[0]!.d); return () => clearTimeout(t);
  }, [a, reduced]);
  const frame = a.frames[Math.min(fi, a.frames.length - 1)]!;
  const listH = Math.max(5, height - 7); const top = Math.max(0, Math.min(idx - Math.floor(listH / 2), list.length - listH));
  const maxPrevH = height - 6; const rowsH = Math.ceil(a.h / 2);
  return (
    <Box width={width} height={height} flexDirection="column" borderStyle="round" borderColor={col('accent.primary')} paddingX={1}>
      <Rich line={[sp('Cento animations', { c: 'accent.hover', b: true }), sp(`   ${bakedNames().length} total   `, { c: 'text.muted' }), ...cats.flatMap((c): Line => [sp(' ' + c.replace('ui_', '') + ' ', { c: c === catName ? 'text.primary' : 'text.muted', b: c === catName, bg: c === catName ? 'bg.selected' : undefined })])]} />
      <Box height={1} />
      <Box flexGrow={1}>
        <Box flexDirection="column" width={26} flexShrink={0}>
          {list.slice(top, top + listH).map((x, i) => { const on = top + i === ((idx % list.length) + list.length) % list.length; return <Rich key={x.name} line={[sp(on ? '▸ ' : '  ', { c: 'accent.hover', b: true }), sp(truncate(x.name, 22), { c: on ? 'text.primary' : 'text.secondary', b: on, bg: on ? 'bg.selected' : undefined })]} />; })}
        </Box>
        <Box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
          <PixelView rows={frame.rows} tier={theme.tier} height={Math.min(rowsH, maxPrevH)} />
          <Box marginTop={1} flexDirection="column" alignItems="center" width={Math.max(20, width - 34)}>
            <Rich line={[sp(truncate(a.desc, width - 34), { c: 'text.secondary' })]} />
            <Rich line={[sp(`${a.frames.length} frames · ${a.social ? 'two characters' : 'solo'} · ${me}`, { c: 'text.muted' })]} />
          </Box>
        </Box>
      </Box>
      <Rich line={[sp('←→ category · ↑↓ animation · c colour · esc close', { c: 'text.muted' })]} />
    </Box>
  );
}

/* --------------------------------------------------------------- model picker */
export function ModelPicker({ sel, current, width }: { sel: number; current: string; width: number }) {
  const col = useCol(); const w = Math.min(70, width - 4);
  return (
    <Box width={width} justifyContent="center"><Box flexDirection="column" width={w} borderStyle="round" borderColor={col('accent.primary')} paddingX={2}>
      <Rich line={[sp('Model', { c: 'accent.hover', b: true }), sp('   applies from your next message', { c: 'text.muted' })]} /><Box height={1} />
      {CLAUDE_MODELS.map((m, i) => {
        const on = i === sel; const cur = m.id === current;
        return <Rich key={m.id || 'default'} line={[sp(on ? '▸ ' : '  ', { c: 'accent.hover', b: true }), sp(m.label.padEnd(18), { c: on ? 'text.primary' : 'text.secondary', b: on, bg: on ? 'bg.selected' : undefined }), sp(cur ? '✓ ' : '  ', { c: 'status.success', b: true }), sp(m.note, { c: 'text.muted' })]} />;
      })}
      <Box height={1} /><Rich line={[sp('↑↓ move · enter choose · esc close · or type /model <any model id>', { c: 'text.muted' })]} />
    </Box></Box>
  );
}
