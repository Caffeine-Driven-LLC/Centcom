import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FocusTrap } from '../a11y/focus.js';
import { Button, Chip } from '../ui/index.js';
import { VAR, INITIAL_ON, STATUS_GLYPH, STATUS_WORD, activityText, roleChip, rosterLine, slotColour, type Status } from './slots.js';
import type { Member } from './roster.js';

export const initialOf = (name: string): string => [...name.trim()][0]?.toUpperCase() ?? '?';
/** 32 px square avatar: the initial on the member's colour, brown with a ring, the sixth person outlined. */
export function PresenceAvatar({ member, selfSlot, status = 'online' }: { member: Member; selfSlot: number; status?: Status }): React.JSX.Element {
  const col = slotColour(member.slot, selfSlot); const bg = VAR[col === 'violet-outlined' ? 'violet' : col]; const fg = VAR[INITIAL_ON[col]];
  return <span className="cc-pavatar" data-colour={col} role="img" aria-label={`${member.name}, ${STATUS_WORD[status]}`} ref={(el) => { if (el) { el.style.setProperty('--pa-bg', bg); el.style.setProperty('--pa-fg', fg); el.style.setProperty('--pa-ring', col === 'brown' ? VAR.ring : col === 'violet-outlined' ? VAR.violet : 'transparent'); } }}>{initialOf(member.name)}<span className={`cc-pdot cc-pdot--${status}`} aria-hidden="true">{STATUS_GLYPH[status]}</span></span>;
}
/** Up to five avatars and `+N`; the whole stack is one button that opens the roster. */
export function PresenceStack({ members, me, status, onOpen }: { members: Member[]; me: string; status(id: string): Status; onOpen(): void }): React.JSX.Element {
  const self = members.find((m) => m.id === me); const online = members.filter((m) => status(m.id) !== 'offline').length; const shown = members.slice(0, 5); const more = members.length - shown.length;
  return <button type="button" className="cc-pstack" aria-label={`Participants, ${online} online`} onClick={onOpen}>{shown.map((m) => <PresenceAvatar key={m.id} member={m} selfSlot={self?.slot ?? 0} status={status(m.id)} />)}{more > 0 ? <span className="cc-pmore">+{more}</span> : null}</button>;
}
/** The roster as a dialog: focus stays inside, Esc closes it, and focus goes back to the button that opened it. */
export function RosterDialog({ open, onClose, members, me, status, activity, since, onNudge, nudgeAllowed, now }: { open: boolean; onClose(): void; members: Member[]; me: string; status(id: string): Status; activity(id: string): string; since(id: string): number | undefined; onNudge(id: string): void; nudgeAllowed(id: string): boolean; now: number }): React.JSX.Element | null {
  const back = useRef<Element | null>(null); useLayoutEffect(() => { if (open) back.current = document.activeElement; else { (back.current as HTMLElement | null)?.focus?.(); back.current = null; } }, [open]);
  if (!open) return null; const self = members.find((m) => m.id === me);
  return <div className="cc-scrim" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}><div role="dialog" aria-modal="true" aria-label="Participants" className="cc-modal"><FocusTrap><h2 className="cc-modal__title">Participants</h2>
    <ul className="cc-plist">{members.map((m) => { const st = status(m.id); const col = slotColour(m.slot, self?.slot ?? 0); return <li key={m.id}><PresenceAvatar member={m} selfSlot={self?.slot ?? 0} status={st} /> <span>{rosterLine(m.name, col)}</span> <Chip>{roleChip(m.role)}</Chip> <span className="cc-help">{activityText(activity(m.id), st, since(m.id), now)}</span>{m.id !== me ? <Button variant="ghost" onClick={() => onNudge(m.id)} disabledReason={nudgeAllowed(m.id) ? undefined : 'You nudged them a moment ago.'}>Nudge</Button> : null}</li>; })}</ul>
    <Button onClick={onClose}>Close</Button></FocusTrap></div></div>;
}
/** "Maya joined" and "Maya left": read out politely and shown for 4 s. */
export function JoinAnnouncer({ events, ttlMs = 4000 }: { events: { id: number; text: string }[]; ttlMs?: number }): React.JSX.Element {
  const [gone, setGone] = useState<Set<number>>(new Set()); useEffect(() => { const hs = events.filter((e) => !gone.has(e.id)).map((e) => setTimeout(() => setGone((g) => new Set(g).add(e.id)), ttlMs)); return () => { for (const h of hs) clearTimeout(h); }; }, [events, ttlMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = events.filter((e) => !gone.has(e.id)); return <div role="status" aria-live="polite" className="cc-toasts">{live.map((e) => <p key={e.id} className="cc-banner cc-banner--info">{e.text}</p>)}</div>;
}
