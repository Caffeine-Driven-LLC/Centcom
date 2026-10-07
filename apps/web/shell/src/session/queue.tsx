import React from 'react';
import { Button, Chip } from '../ui/index.js';
import { slotColour, type SlotColour } from '../presence/slots.js';
import type { QueueItemView } from '@centcom/guest';

export type SessionRole = 'host' | 'editor' | 'viewer';
export interface QueueActions { approve?(item: string): void; reject?(item: string): void; drop?(item: string): void; move?(item: string, dir: -1 | 1): void; cancel?(item: string): void; edit?(item: string): void }
const DOT: Record<SlotColour, string> = { violet: 'cc-dot--v', red: 'cc-dot--r', yellow: 'cc-dot--y', green: 'cc-dot--g', brown: 'cc-dot--b', 'violet-outlined': 'cc-dot--v' };
const cut = (s: string, n = 28): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** The queue above the composer: `● Name · "text…" · #2`. Item text is shown only when the caller has it (the body is encrypted); otherwise the kind is. Hosts approve, edit, reorder and drop; a guest sees their own items with Cancel; a viewer sees the queue and nothing to press. */
export function QueueStrip({ queue, role, self, nameOf, slotOf, textOf, selfSlot = 0, actions, muted }: { queue: { version: number; items: QueueItemView[] }; role: SessionRole; self: string; nameOf(id: string): string; slotOf(id: string): number; textOf?(item: string): string | undefined; selfSlot?: number; actions?: QueueActions; muted?: boolean }): React.JSX.Element {
  if (!queue.items.length) return <div className="cc-queue" id="queue" tabIndex={-1} aria-label="Queue"><span className="cc-help">Nothing is waiting.</span></div>;
  return <ul className="cc-queue" id="queue" tabIndex={-1} aria-label={`Queue, ${queue.items.length} waiting`}>{queue.items.map((it, i) => { const mine = it.submitter === self; const col = slotColour(slotOf(it.submitter), selfSlot); const t = textOf?.(it.item); const running = it.state === 'running';
    return <li key={it.item} className="cc-queue__item"><span className={`cc-qdot ${DOT[col]}`} aria-hidden="true" /> <strong>{mine ? 'You' : nameOf(it.submitter)}</strong> · <span>{t ? `"${cut(t)}"` : it.kind}</span> · <span>{running ? 'running' : `#${it.position === null ? i + 1 : it.position + 1}`}</span> <Chip>{it.state}</Chip>
      {role === 'host' && !running ? <>{it.state === 'queued' ? <Button variant="ghost" onClick={() => actions?.approve?.(it.item)}>Approve</Button> : null}{it.state === 'queued' ? <Button variant="ghost" onClick={() => actions?.reject?.(it.item)}>Reject</Button> : null}<Button variant="ghost" aria-label="Move up" onClick={() => actions?.move?.(it.item, -1)} disabledReason={i === 0 ? 'It is already first.' : undefined}>↑</Button><Button variant="ghost" aria-label="Move down" onClick={() => actions?.move?.(it.item, 1)} disabledReason={i === queue.items.length - 1 ? 'It is already last.' : undefined}>↓</Button><Button variant="ghost" onClick={() => actions?.edit?.(it.item)}>Edit</Button><Button variant="ghost" onClick={() => actions?.drop?.(it.item)}>Drop</Button></> : null}
      {role === 'editor' && mine && (it.state === 'queued' || it.state === 'approved') ? <Button variant="ghost" disabledReason={muted ? 'Muted by host' : undefined} onClick={() => actions?.cancel?.(it.item)}>Cancel</Button> : null}</li>; })}</ul>;
}
/** Who sees the composer, and what it says when it is off. */
export function composerState(role: SessionRole, muted: boolean, phase: string, locked = false): { show: boolean; enabled: boolean; reason?: string } {
  if (role === 'viewer') return { show: false, enabled: false }; if (muted) return { show: true, enabled: false, reason: 'Muted by host' }; if (phase === 'ended' || phase === 'kicked') return { show: true, enabled: false, reason: 'This session is over.' }; if (locked && role !== 'host') return { show: true, enabled: false, reason: 'The host locked the queue.' }; if (phase === 'reconnecting') return { show: true, enabled: true, reason: 'Reconnecting. Your message is sent when the connection is back.' }; return { show: true, enabled: true };
}
