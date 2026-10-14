import { useParams, useSearch } from '@tanstack/react-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, getToken } from '../auth/runtime.js';
import { parseEnv } from '../lib/env.js';
import { JoinAnnouncer, PresenceStack, RosterDialog } from '../presence/components.js';
import { statusOf, useJoinEvents, usePresenceFeed, type PresenceLink } from '../presence/feed.js';
import { usePresencePublisher } from '../presence/use-presence.js';
import { activityText } from '../presence/slots.js';
import { Banner, Button, Chip, LiveRegion } from '../ui/index.js';
import { QueueStrip, composerState, type SessionRole } from './queue.js';
import { PhaseScreen, TranscriptView } from './transcript.js';
import { sessionLoader } from './lazy.js';
import { useSession } from './use-session.js';
import type { ShareJoin } from './engine.js';
import { takeInviteHandoff, type InviteHandoff } from './handoff.js';
import type { Member } from '../presence/roster.js';

export const CONNECTION_TEXT = { live: 'relay', reconnecting: 'reconnecting', offline: 'offline' } as const;
/** The command post: header, transcript, queue strip, composer. `a` and `d` approve and deny the focused approval, `g` then `q` jumps to the queue. */
export function SessionPage(): React.JSX.Element { const { sessionId } = useParams({ strict: false }) as { sessionId: string }; return <SessionScreen sessionId={sessionId} />; }
/** The same page for a guest who came in through a watch link: no account, a viewer, and the key stays in memory. */
export function SessionScreen({ sessionId, share }: { sessionId: string; share?: ShareJoin }): React.JSX.Element {
  const search = useSearch({ strict: false }) as { focus?: string }; const { status } = useAuth(); const hand = useRef<InviteHandoff | null | undefined>(undefined); if (hand.current === undefined) hand.current = share ? null : takeInviteHandoff(sessionId) ?? null; // an invite accepted on the way here: taken once, in memory
  const env = useMemo(() => parseEnv(import.meta.env as Record<string, unknown>).env, []); const api = useSession({ sessionId, ...(share ? { share } : {}), apiBase: env.apiBase, ...(hand.current?.secret ? { inviteToken: hand.current.token, inviteSecret: hand.current.secret } : {}), relayUrl: `${env.relayBase}/v1/ws`, getAccessToken: () => getToken().catch(() => undefined), deviceId: pageDevice() }, sessionLoader());
  const s = api.state; const role = s.me.role as SessionRole; const [draft, setDraft] = useState(''); const [announce, setAnnounce] = useState(''); const last = useRef(''); const chord = useRef(false);
  const link0 = api.connection?.handle as unknown as PresenceLink | undefined; const feed = usePresenceFeed(link0, Date.now, { me: s.me.member, role }); const presence = usePresencePublisher(feed.sink); const [rosterOpen, setRosterOpen] = useState(false); const [clock, setClock] = useState(() => Date.now());
  const comp = composerState(role, s.me.muted, s.phase); const members: Member[] = s.roster.map((m) => ({ id: m.id, name: m.name, slot: m.slot, role: m.role, connected: m.connected })); const joins = useJoinEvents(members, s.me.member); const statusFor = (id: string) => statusOf(members.find((m) => m.id === id), feed.info(id));
  useEffect(() => { const on = (e: Event): void => presence.input(e.type === 'keydown' && (e.target as HTMLElement | null)?.id === 'composer'); const w = window; w.addEventListener('keydown', on); w.addEventListener('pointerdown', on); return () => { w.removeEventListener('keydown', on); w.removeEventListener('pointerdown', on); }; }, [presence]);
  useEffect(() => { if (!rosterOpen) return; const h = setInterval(() => setClock(Date.now()), 30_000); setClock(Date.now()); return () => clearInterval(h); }, [rosterOpen]);
  useEffect(() => { const a = [...s.transcript].reverse().find((e) => e.kind === 'assistant' && !e.done); if (a && a.kind === 'assistant' && a.messageId !== last.current) { last.current = a.messageId; setAnnounce('Cento is writing'); } else if (!a) setAnnounce(''); }, [s.transcript]);
  useEffect(() => { const on = (e: KeyboardEvent): void => { const t = e.target as HTMLElement | null; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return; if (chord.current) { chord.current = false; if (e.key === 'q') { e.preventDefault(); document.getElementById('queue')?.focus(); } return; } if (e.key === 'g') { chord.current = true; setTimeout(() => { chord.current = false; }, 1000); return; } if (role !== 'host' || (e.key !== 'a' && e.key !== 'd')) return; const card = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-approval]'); const id = card?.dataset.approval; if (id) { e.preventDefault(); void api.host?.decide(id, e.key === 'a' ? 'allow' : 'deny'); } }; document.addEventListener('keydown', on); return () => document.removeEventListener('keydown', on); }, [role, api.host]);
  useEffect(() => { if (search.focus === 'queue') document.getElementById('queue')?.focus(); }, [search.focus, s.phase]);
  if (status === 'anonymous' && !share) return <Banner tone="info" title="Sign in to open this session">Use the sign-in page, then come back to this link.</Banner>; if (api.error) return <Banner tone="danger" title="The session could not be opened">Try again in a moment.</Banner>;
  const link = s.phase === 'live' ? 'live' : s.phase === 'reconnecting' ? 'reconnecting' : 'offline';
  return <section aria-label="Session" className="cc-session"><header className="cc-sessionhead"><strong>Session</strong> {s.hostId ? <Chip>HOST {s.roster.find((m) => m.id === s.hostId)?.name ?? ''}</Chip> : null}<PresenceStack members={members} me={s.me.member} status={statusFor} onOpen={() => setRosterOpen(true)} /><Chip tone={link === 'live' ? 'success' : 'warning'}>{CONNECTION_TEXT[link]}</Chip>{role === 'host' ? <Button disabledReason="Invite people from the Centcom app that started this session: the invite carries the session key.">Invite</Button> : null}</header>
    <JoinAnnouncer events={joins} />
    <RosterDialog open={rosterOpen} onClose={() => setRosterOpen(false)} members={members} me={s.me.member} status={statusFor} activity={(id) => feed.info(id)?.activity ?? 'idle'} since={(id) => feed.info(id)?.since} onNudge={(id) => { if (feed.nudge(id)) setAnnounce(`You nudged ${members.find((m) => m.id === id)?.name ?? 'them'}`); }} nudgeAllowed={(id) => feed.canNudge(id)} now={clock} />
    <PhaseScreen phase={s.phase} />
    <TranscriptView entries={s.transcript} isHost={role === 'host'} actions={api.host ? { approve: (id) => void api.host!.decide(id, 'allow'), deny: (id) => void api.host!.decide(id, 'deny') } : undefined} />
    <LiveRegion politeness="polite">{feed.nudges.length ? `${members.find((m) => m.id === feed.nudges.at(-1)!.from)?.name ?? 'Someone'} nudged you` : announce}</LiveRegion>
    <QueueStrip queue={s.queue} role={role} self={s.me.member} nameOf={(id) => s.roster.find((m) => m.id === id)?.name ?? 'Someone'} slotOf={(id) => s.roster.find((m) => m.id === id)?.slot ?? 0} selfSlot={s.me.slot} muted={s.me.muted} actions={{ approve: (i) => void api.host?.approve(i), reject: (i) => void api.host?.reject(i, 'declined'), drop: (i) => void api.host?.drop(i), cancel: (i) => void api.cancel(i), move: (i, d) => { const ids = s.queue.items.map((x) => x.item); const at = ids.indexOf(i); const to = at + d; if (to < 0 || to >= ids.length) return; [ids[at], ids[to]] = [ids[to]!, ids[at]!]; void api.host?.reorder(ids); } }} />
    {comp.show ? <form onSubmit={(e) => { e.preventDefault(); if (draft.trim() && comp.enabled) { void api.submit(draft.trim()).then(() => setDraft('')).catch(() => undefined); } }}><label className="cc-label" htmlFor="composer">Message</label><textarea id="composer" className="cc-input" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!comp.enabled} rows={2} /><Button variant="primary" type="submit" disabledReason={comp.reason ?? (draft.trim() ? undefined : 'Write something first.')}>Send</Button></form> : <p className="cc-help">You are watching this session.</p>}</section>;
}

/** One id per open page: the device keys of a browser tab live in memory only, so each tab is its own device. */
function pageDevice(): string { try { const b = crypto.getRandomValues(new Uint8Array(16)); return `dev_${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('').toUpperCase()}`; } catch { return `dev_${Date.now().toString(16).toUpperCase()}`; } }
