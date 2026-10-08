import React from 'react';
import { Rich } from '../components/ui.js';
import { sp, truncate, type Line, type Span } from '../util/text.js';
import { MESSAGES } from './messages.js';

export const CHIP_MAX = 40;
/** `runs on <name> · <provider>`, at most 40 columns (the name gives way). Dim when the viewer pays, the member's colour otherwise. */
export function runsOnChip(o: { owner: string; payer?: string; provider: string; viewerPays?: boolean; color?: Span['c'] }): Line {
  const tail = MESSAGES['provider.runs_on']({ name: '', provider: o.provider }); const room = Math.max(1, CHIP_MAX - tail.length);
  const text = MESSAGES['provider.runs_on']({ name: truncate(o.payer ?? o.owner, room), provider: o.provider });
  return [sp(truncate(text, CHIP_MAX), o.viewerPays ? { c: 'text.muted' } : { c: o.color ?? 'text.secondary' })];
}
export function RunsOnChip(p: { owner: string; payer?: string; provider: string; viewerPays?: boolean; color?: Span['c'] }): React.JSX.Element { return <Rich line={runsOnChip(p)} />; }
