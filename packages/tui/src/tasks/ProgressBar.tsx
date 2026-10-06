import React, { useEffect, useState } from 'react';
import { Box } from 'ink';
import { Rich } from '../components/ui.js';
import { sp } from '../util/text.js';
import { indeterminateFrame, percent, renderBar, truncate } from './model.js';

export const TICK_MS = 80; export const MIN_CELLS = 10;
let warned = false;
/** A labelled progress bar. `value` 0..1 (clamped); leave it out for "busy, no idea how long". The label is required: a bar always says what is progressing. */
export function ProgressBar({ value, label, width, motion = 'full', unicode = true }: { value?: number; label: string; width: number; motion?: 'full' | 'reduced'; unicode?: boolean }) {
  if (!label && !warned && process.env.NODE_ENV !== 'production') { warned = true; console.warn('ProgressBar needs a label: say what is progressing.'); }
  const det = value !== undefined && Number.isFinite(value); const pct = det ? percent(value) : '';
  const cells = Math.max(MIN_CELLS, Math.min(40, width - label.length - (det ? pct.length + 1 : 2) - 4)); const room = width - cells - 3 - (det ? pct.length + 1 : 0); const shownLabel = truncate(label, Math.max(1, room));
  const [tick, setTick] = useState(0); const animate = !det && motion === 'full';
  useEffect(() => { if (!animate) return; const t = setInterval(() => setTick((n) => n + 1), TICK_MS); return () => clearInterval(t); }, [animate]);
  const bar = det ? renderBar(value, cells, unicode) : animate ? indeterminateFrame(tick, cells, Math.min(6, Math.floor(cells / 2)), unicode) : (unicode ? '░' : '-').repeat(cells);
  const [l, r] = unicode ? ['▕', '▏'] : ['[', ']'];
  return <Box><Rich line={[sp(`${shownLabel}${!det && !animate ? '…' : ''} `, { c: 'text.secondary' }), sp(l, { c: 'border.subtle' }), sp(bar, { c: 'signal' }), sp(r, { c: 'border.subtle' }), ...(det ? [sp(` ${pct}`, { c: 'text.muted' })] : [])]} /></Box>;
}
