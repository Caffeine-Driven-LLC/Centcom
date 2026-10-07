import { useEffect, useMemo, useRef, useState } from 'react';
import { initialGuestState, type GuestState } from '@centcom/guest';
import type { ConnectOptions, SessionConnection } from './engine.js';
import { loadEngine } from './lazy.js';

export type Loader = () => Promise<{ connectSession(o: ConnectOptions): Promise<SessionConnection> }>;
export interface SessionApi {
  state: GuestState; error?: string; connection?: SessionConnection;
  submit(body: string): Promise<void>; cancel(item: string): Promise<void>;
  host?: { approve(item: string): Promise<void>; reject(item: string, code: string): Promise<void>; reorder(order: string[]): Promise<void>; drop(item: string): Promise<void>; decide(approvalId: string, decision: 'allow' | 'deny'): Promise<void> };
}
const ids = (): string => `que_${Date.now().toString(32).toUpperCase().padStart(8, '0')}${Math.random().toString(32).slice(2, 20).toUpperCase().padEnd(18, '0')}`.slice(0, 30);
/** Connects when the page opens (the engine and its crypto are fetched then, not before), keeps the guest state, and offers the actions the role allows. A new ticket is fetched by the engine for every connect attempt; nothing here sees one. */
export function useSession(o: ConnectOptions, load: Loader = loadEngine): SessionApi {
  const [state, setState] = useState<GuestState>(() => initialGuestState({ member: '' })); const [error, setError] = useState<string>(); const conn = useRef<SessionConnection | undefined>(undefined);
  useEffect(() => { let dead = false; let off: (() => void) | undefined; void load().then((m) => m.connectSession(o)).then((c) => { if (dead) { c.close(); return; } conn.current = c; off = c.subscribe(setState); }).catch((e: unknown) => { if (!dead) setError(e instanceof Error ? e.message : 'The session could not be opened.'); }); return () => { dead = true; off?.(); conn.current?.close(); conn.current = undefined; }; }, [o.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const send = async (kind: string, body: { p?: Record<string, unknown>; secret?: Record<string, unknown> }): Promise<void> => { const c = conn.current; if (!c) throw new Error('not connected'); await c.handle.sendEvent(kind, body); };
    const isHost = state.me.role === 'host';
    return { state, error, connection: conn.current,
      submit: async (body) => { if (state.me.role === 'viewer' || state.me.muted) throw new Error('forbidden'); const c = conn.current; if (!c) throw new Error('not connected'); await c.handle.sendEvent('queue.submit', { p: (info) => ({ item: ids(), size: info.ctBytes, kind: 'message' }), secret: { body } }); },
      cancel: (item) => send('queue.cancel', { p: { item } }),
      ...(isHost ? { host: { approve: (item: string) => send('queue.approve', { p: { item } }), reject: (item: string, code: string) => send('queue.reject', { p: { item, code } }), reorder: (order: string[]) => send('queue.reorder', { p: { order } }), drop: (item: string) => send('queue.drop', { p: { item } }), decide: (approvalId: string, decision: 'allow' | 'deny') => send('approval.decision', { p: { approval_id: approvalId, decision, scope: 'once' } }) } } : {}) };
  }, [state, error]);
}
