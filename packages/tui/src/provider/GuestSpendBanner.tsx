import React from 'react';
import { Box, useInput } from 'ink';
import { Rich } from '../components/ui.js';
import { sp, type Line } from '../util/text.js';
import { MESSAGES } from './messages.js';

export interface GuestSpendLineInput { count: number; provider: string; paused: boolean; /** The roster is not available: the last known count, dimmed. */ stale?: boolean; /** The last pause or resume failed (the previous state is kept). */ failed?: boolean }
/** Hidden for 0 guests. While paused: `Guests paused` and a resume key. */
export function guestSpendLine(o: GuestSpendLineInput): Line | undefined {
  if (o.count <= 0) return undefined;
  const fail: Line = o.failed ? [sp('  ' + MESSAGES['provider.pause_failed'](), { c: 'status.danger' })] : [];
  if (o.paused) return [sp(MESSAGES['provider.guests_paused'](), { c: 'status.warning', b: true }), sp('  ' + MESSAGES['provider.resume_hint'](), { c: 'text.muted' }), ...fail];
  return [sp(MESSAGES['provider.guests_spend']({ count: o.count, provider: o.provider }), { c: o.stale ? 'text.muted' : 'status.warning' }), sp('  ' + MESSAGES['provider.pause_hint'](), { c: 'text.muted' }), ...fail];
}
export function GuestSpendBanner({ count, provider, paused, onPause, onResume, active = true, stale = false, failed = false }: { count: number; provider: string; paused: boolean; onPause(): void; onResume(): void; active?: boolean; stale?: boolean; failed?: boolean }): React.JSX.Element | null {
  useInput((input) => { if (!paused && input === 'p') onPause(); else if (paused && input === 'r') onResume(); }, { isActive: active && (count > 0) });
  const line = guestSpendLine({ count, provider, paused, stale, failed }); return line ? <Box><Rich line={line} /></Box> : null;
}
