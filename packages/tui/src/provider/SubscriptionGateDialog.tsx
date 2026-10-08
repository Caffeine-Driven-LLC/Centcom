import React from 'react';
import { Box, useInput } from 'ink';
import { Rich } from '../components/ui.js';
import { sp, type Line } from '../util/text.js';
import { MESSAGES } from './messages.js';

export const gateDialogLines = (o: { engine: string }): Line[] => [[sp(MESSAGES['provider.cp_subscription.title'](o), { c: 'text.primary', b: true })], [sp(MESSAGES['provider.cp_subscription.notice'](o), { c: 'text.secondary' })], [sp(MESSAGES['provider.cp_subscription.keys'](), { c: 'text.muted' })]];
/** `y` confirms, `n` or Escape cancels. */
export function SubscriptionGateDialog({ engine, onConfirm, onCancel }: { engine: string; onConfirm(): void; onCancel(): void }): React.JSX.Element {
  useInput((input, key) => { if (input === 'y') onConfirm(); else if (input === 'n' || key.escape) onCancel(); });
  return <Box flexDirection="column" borderStyle="round" paddingX={1}>{gateDialogLines({ engine }).map((l, i) => <Rich key={i} line={l} />)}</Box>;
}
