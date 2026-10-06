import React, { useEffect, useRef, useState } from 'react';
import { Box } from 'ink';
import { Rich } from '../components/ui.js';
import { sp, truncate } from '../util/text.js';
import { formatElapsed, formatTokens } from './format.js';
import { createVerbPicker, isSeriousState, nextVerbDelayMs, plainVerb, type VerbPicker } from './picker.js';

export const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const; export const FRAME_MS = 80;
export interface SpinnerProps {
  state: string; startedAt: Date; tokens?: number; interruptible?: boolean; width?: number; motion?: 'full' | 'reduced'; serious?: boolean;
  /** Injected for tests; the real thing uses the clock and Math.random. */ now?: () => number; rng?: () => number; plain?: boolean;
  /** False (not a terminal, or a screen reader): one static line, no animation. */ animate?: boolean;
}
/** The meta in the parentheses: elapsed time after 2 s, tokens after 5 s, the interrupt hint whenever the work can be stopped. */
export function metaText(elapsedMs: number, o: { tokens?: number; interruptible?: boolean }): string {
  const parts: string[] = []; if (elapsedMs >= 2000) parts.push(formatElapsed(elapsedMs)); if (elapsedMs >= 5000 && o.tokens !== undefined) parts.push(`↑ ${formatTokens(o.tokens)} tokens`); if (o.interruptible) parts.push('esc to interrupt');
  return parts.length ? `(${parts.join(' · ')})` : '';
}
/** Everything the line says at one moment (no React): used by the component and by tests. */
export function spinnerLine(p: { elapsedMs: number; verb: string; tokens?: number; interruptible?: boolean; width: number; motion?: 'full' | 'reduced'; unicode?: boolean; /** Not a terminal: the glyph does not move. */ still?: boolean }): { glyph: string; verb: string; meta: string } {
  const n = p.still ? 0 : Math.floor(p.elapsedMs / FRAME_MS); const frame = p.motion === 'reduced' ? '…' : FRAMES[n % FRAMES.length]!; const glyph = p.motion !== 'reduced' && p.unicode === false ? '-\\|/'[n % 4]! : frame;
  let meta = metaText(p.elapsedMs, p); const room = Math.max(8, p.width - 2); /* the meta is cut first, then the verb; the line is one row */
  if (p.verb.length + 1 + meta.length > room) meta = p.verb.length + 1 + metaText(p.elapsedMs, { interruptible: p.interruptible }).length <= room ? metaText(p.elapsedMs, { interruptible: p.interruptible }) : '';
  return { glyph, verb: truncate(p.verb, Math.max(4, room - (meta ? meta.length + 1 : 0))), meta };
}

/** The working indicator: braille glyph, a rotating verb, and what it is costing. */
export function Spinner(p: SpinnerProps) {
  const now = p.now ?? Date.now; const rng = p.rng ?? Math.random; const width = p.width ?? 80; const reduced = p.motion === 'reduced'; const animate = p.animate ?? !!process.stdout.isTTY;
  const picker = useRef<VerbPicker | undefined>(undefined); picker.current ??= createVerbPicker({ rng, plain: p.plain }); const serious = !!p.serious || isSeriousState(p.state);
  const verbAt = useRef<{ verb: string; until: number } | undefined>(undefined);
  const [, tick] = useState(0);
  useEffect(() => { if (!animate) return; const h = setInterval(() => tick((n) => n + 1), reduced ? 1000 : FRAME_MS); return () => clearInterval(h); }, [animate, reduced]);
  const t = now(); const elapsed = Math.max(0, t - p.startedAt.getTime());
  if (!verbAt.current || (animate && t >= verbAt.current.until)) { const verb = picker.current.next({ state: p.state, elapsedMs: elapsed, width, serious }); verbAt.current = { verb, until: t + (reduced ? 30_000 : nextVerbDelayMs(rng)) }; }
  const l = spinnerLine({ elapsedMs: elapsed, still: !animate, verb: serious ? plainVerb(p.state) : verbAt.current.verb, tokens: p.tokens, interruptible: p.interruptible, width, motion: reduced ? 'reduced' : 'full' });
  return <Box width={width}><Rich line={[sp(l.glyph + ' ', { c: 'accent.primary' }), sp(l.verb, { c: 'text.muted' }), ...(l.meta ? [sp('   ' + l.meta, { c: 'text.muted' })] : [])]} /></Box>;
}
