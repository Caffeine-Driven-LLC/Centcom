import React from 'react';
import { Rich } from '../components/ui.js';
import { memberColor } from '../theme/member.js';
import { sp, truncate, type Line } from '../util/text.js';
import { MESSAGES } from './messages.js';

export const CHIP_MAX = 40;
export interface RunsOnChipProps { payerName: string; payerSlot: number; isSelf: boolean; provider: 'anthropic' | 'openai' | 'other'; /** The viewer's own slot, so the member colour matches the roster (default: nobody, every payer gets a member colour). */ selfSlot?: number }
/** The words of the chip, also its accessibility label (a terminal has no aria, so a screen-reader mode prints exactly this). At most 40 columns: the name gives way. */
export function runsOnLabel(o: Pick<RunsOnChipProps, 'payerName' | 'provider'>): string {
  const tail = MESSAGES['provider.runs_on']({ name: '', provider: o.provider }); const room = Math.max(1, CHIP_MAX - tail.length);
  return truncate(MESSAGES['provider.runs_on']({ name: truncate(o.payerName, room), provider: o.provider }), CHIP_MAX);
}
/** `runs on <name> · <provider>`. Dim when the viewer pays, the payer's member colour otherwise. */
export function runsOnChip(o: RunsOnChipProps): Line {
  const text = runsOnLabel(o); if (o.isSelf) return [sp(text, { c: 'text.muted' })];
  return [sp(text, { c: memberColor(o.payerSlot, o.selfSlot ?? -1).hex as `#${string}` })];
}
export function RunsOnChip(p: RunsOnChipProps): React.JSX.Element { return <Rich line={runsOnChip(p)} />; }
