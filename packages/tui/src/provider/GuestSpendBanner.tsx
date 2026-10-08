import React from 'react';
import { Box, useInput } from 'ink';
import { Rich } from '../components/ui.js';
import { sp, type Line } from '../util/text.js';
import { MESSAGES } from './messages.js';

/** Hidden for 0 guests. While paused: `Guests paused` and a resume key. */
export function guestSpendLine(o: { count: number; provider: string; paused: boolean }): Line | undefined {
  if (o.count <= 0) return undefined;
  if (o.paused) return [sp(MESSAGES['provider.guests_paused'](), { c: 'status.warning', b: true }), sp('  ' + MESSAGES['provider.resume_hint'](), { c: 'text.muted' })];
  return [sp(MESSAGES['provider.guests_spend']({ count: o.count, provider: o.provider }), { c: 'status.warning' }), sp('  ' + MESSAGES['provider.pause_hint'](), { c: 'text.muted' })];
}
export function GuestSpendBanner({ count, provider, paused, onPause, onResume, active = true }: { count: number; provider: string; paused: boolean; onPause(): void; onResume(): void; active?: boolean }): React.JSX.Element | null {
  useInput((input) => { if (!paused && input === 'p') onPause(); else if (paused && input === 'r') onResume(); }, { isActive: active && (count > 0) });
  const line = guestSpendLine({ count, provider, paused }); return line ? <Box><Rich line={line} /></Box> : null;
}
