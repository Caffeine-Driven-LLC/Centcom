/** The browser session engine: the net library's session client (hello and welcome, heartbeat, acks, resume, keys, snapshots) with the page's WebSocket and in-memory keys. This file is loaded lazily, so non-session pages never fetch libsodium. */
import './buffer-global.js';
import { createHttpClient } from '@centcom/net';
import { DeviceKeyStore, TrustStore, initCrypto, memoryKeychain } from '@centcom/net-crypto';
import { createSessionClient, type SessionHandle } from '@centcom/net-session';
import { reduceGuestState, initialGuestState, GuestIngest, type DecodedFrame, type GuestState } from '@centcom/guest';
import { browserWsFactory } from './ws.js';

export interface ConnectOptions { sessionId: string; apiBase: string; relayUrl?: string; getAccessToken(): Promise<string | undefined>; deviceId: string; inviteToken?: string; inviteSecret?: string; version?: string }
export interface SessionConnection { handle: SessionHandle; state(): GuestState; subscribe(fn: (s: GuestState) => void): () => void; close(): void }
/** Turns the client's decoded events into the guest reducer's state. Frames are put in order first; unreadable ones never reach here (the client counts them). */
export function bridge(handle: SessionHandle): SessionConnection {
  let st = initialGuestState({ member: handle.me.id, slot: handle.me.slot, role: handle.me.role as 'host' | 'editor' | 'viewer' }); const subs = new Set<(s: GuestState) => void>(); const ing = new GuestIngest<DecodedFrame>(); const set = (s: GuestState): void => { st = s; for (const f of [...subs]) f(s); };
  const offAny = handle.onAny((e) => { const f = { v: 1, t: 'event', id: e.id, sid: handle.id, from: e.from, ts: e.ts, k: e.kind, seq: e.seq, ...(e.p ? { p: e.p } : {}), ...(e.secret ? { secret: e.secret } : {}) } as unknown as DecodedFrame; if (!e.seq) return; let s = st; for (const g of ing.push(f)) s = reduceGuestState(s, g); if (s !== st) set(s); }, { replay: true });
  const offState = handle.on('state', (s) => set({ ...st, phase: s === 'live' ? (st.roster.length ? 'live' : 'connecting') : s === 'waiting_for_key' ? 'waiting_for_key' : s === 'reconnecting' ? 'reconnecting' : s === 'ended' ? 'ended' : st.phase }));
  const offEnded = handle.on('ended', (e) => set({ ...st, phase: e.code === 4403 ? 'kicked' : 'ended' })); const offRemoved = handle.on('removed', () => set({ ...st, phase: 'kicked' }));
  return { handle, state: () => st, subscribe: (f) => { subs.add(f); f(st); return () => { subs.delete(f); }; }, close: () => { offAny(); offState(); offEnded(); offRemoved(); void (handle as unknown as { leave?: () => Promise<void> }).leave?.(); } };
}
export async function connectSession(o: ConnectOptions): Promise<SessionConnection> {
  await initCrypto(); const keychain = memoryKeychain(); const device = new DeviceKeyStore(keychain, o.deviceId); await device.getOrCreatePublicKeys(); /* the keys live in this page only */
  const http = createHttpClient({ baseUrl: o.apiBase, getAccessToken: async () => (await o.getAccessToken()) ?? '', userAgent: `centcom-web/${o.version ?? '0'}` });
  const client = createSessionClient({ http: http as never, crypto: { device, trust: new TrustStore({ read: async () => undefined, write: async () => undefined } as never) }, deviceId: o.deviceId, clientInfo: { name: 'centcom-web', version: o.version ?? '0.1.0', contract: '1.2.0' }, wsFactory: browserWsFactory(), ...(o.relayUrl ? { relayUrl: o.relayUrl } : {}), fetch: (i, n) => fetch(i, n) });
  return bridge(await client.joinSession({ sessionId: o.sessionId, ...(o.inviteToken && o.inviteSecret ? { inviteToken: o.inviteToken, inviteSecret: o.inviteSecret } : {}) }));
}
