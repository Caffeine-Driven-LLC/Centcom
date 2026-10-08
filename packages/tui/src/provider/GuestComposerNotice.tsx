import React from 'react';
import { Rich } from '../components/ui.js';
import { sp, type Line } from '../util/text.js';
import { MESSAGES } from './messages.js';

export const guestComposerNotice = (o: { host: string; provider?: string }): Line => [sp(MESSAGES['provider.guest_notice']({ host: o.host }), { c: 'text.muted' })];
export function GuestComposerNotice(p: { host: string; provider?: string }): React.JSX.Element { return <Rich line={guestComposerNotice(p)} />; }
