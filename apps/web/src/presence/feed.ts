import { useEffect, useMemo, useRef, useState } from 'react';
import type { Member } from './roster.js';
import type { RemoteCursor } from './cursors.js';
import type { Sink } from './publisher.js';
import type { Status } from './slots.js';

/** The part of a session connection this needs: a way to hear every event and a way to send one. */
export interface PresenceLink {
  onAny(fn: (e: { kind: string; from: string; p?: Record<string, unknown>; secret?: Record<string, unknown> }) => void): () => void;
  sendEvent(kind: string, body: { p?: Record<string, unknown>; secret?: Record<string, unknown> }): Promise<unknown>;
}
const str = (v: unknown): string => (typeof v === 'string' ? v : ''); const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
export interface PresenceInfo { status: 'online' | 'away' | 'busy'; activity: string; since: number }

/**
 * What the other people are doing, from `presence.update` (clear) and `presence.cursor` (encrypted), and where your own presence goes.
 * Time is the time a frame arrived here, never the frame's own `ts`. Nothing depends on it: no frame, or a refused send, only means less to show.
 */
export function usePresenceFeed(link: PresenceLink | undefined, now: () => number = Date.now): { info(id: string): PresenceInfo | undefined; cursors: Map<string, RemoteCursor>; sink: Sink | undefined } {
  const people = useRef(new Map<string, PresenceInfo>()); const cursors = useRef(new Map<string, RemoteCursor>()); const [ver, bump] = useState(0);
  useEffect(() => {
    if (!link || typeof link.onAny !== 'function') return;
    return link.onAny((e) => {
      if (e.kind === 'presence.update') { const st = str(e.p?.['status']); people.current.set(e.from, { status: st === 'away' || st === 'busy' ? st : 'online', activity: str(e.p?.['activity']) || 'idle', since: now() }); bump((x) => x + 1); }
      else if (e.kind === 'presence.cursor') { const s = e.secret; if (!s) { cursors.current.delete(e.from); } else { const line = num(s['line']); cursors.current.set(e.from, { member: e.from, path: str(s['path']), ...(line !== undefined ? { line } : {}), ...(num(s['col']) !== undefined ? { col: num(s['col'])! } : {}), receivedAt: now() }); } bump((x) => x + 1); }
    });
  }, [link, now]);
  const sink = useMemo<Sink | undefined>(() => link ? { update: (p) => { void link.sendEvent('presence.update', { p: { ...p } }).catch(() => undefined); }, cursor: (c) => { void link.sendEvent('presence.cursor', { secret: c ?? {} }).catch(() => undefined); } } : undefined, [link]);
  return useMemo(() => ({ info: (id: string) => people.current.get(id), cursors: cursors.current, sink }), [sink, ver]); // the maps change in place; ver says when
}

/** "Maya joined" and "Maya left", from the roster changing. The first roster is not announced, and you are not announced to yourself. */
export function useJoinEvents(roster: readonly Member[], me: string): { id: number; text: string }[] {
  const prev = useRef<Map<string, Member> | undefined>(undefined); const [events, setEvents] = useState<{ id: number; text: string }[]>([]); const next = useRef(1);
  useEffect(() => {
    const cur = new Map(roster.map((m) => [m.id, m])); const before = prev.current; prev.current = cur; if (!before || !roster.length) return;
    const add: { id: number; text: string }[] = [];
    for (const m of roster) if (!before.has(m.id) && m.id !== me) add.push({ id: next.current++, text: `${m.name} joined` });
    for (const m of before.values()) if (!cur.has(m.id) && m.id !== me) add.push({ id: next.current++, text: `${m.name} left` });
    if (add.length) setEvents((e) => [...e.slice(-4), ...add]);
  }, [roster, me]);
  return events;
}

export const statusOf = (member: Member | undefined, info: PresenceInfo | undefined): Status => (!member || !member.connected ? 'offline' : info?.status ?? 'online');
