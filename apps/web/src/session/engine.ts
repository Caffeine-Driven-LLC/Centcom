/** The browser session engine: the net library's session client (hello and welcome, heartbeat, acks, resume, keys, snapshots) with the page's WebSocket and in-memory keys. This file is loaded lazily, so non-session pages never fetch libsodium. */
import './buffer-global.js';
import { createHttpClient, defaultUserAgent } from '@centcom/net';
import { DeviceKeyStore, TrustStore, initCrypto, memoryKeychain } from '@centcom/net-crypto';
import { createSessionClient, type SessionHandle } from '@centcom/net-session';
import { reduceGuestState, initialGuestState, type DecodedFrame, type GuestState } from '@centcom/guest';
import { TailFeed } from './feed.js';
import { browserWsFactory } from './ws.js';

/** A watch link: the guest joins without an account, as a viewer. `fragment` is the `#k=...&kid=...` text of the link. */
export interface ShareJoin { token: string; displayName: string; fragment: string }
export interface ConnectOptions { sessionId: string; share?: ShareJoin; apiBase: string; relayUrl?: string; getAccessToken(): Promise<string | undefined>; deviceId: string; inviteToken?: string; inviteSecret?: string; version?: string }
export interface SessionConnection { handle: SessionHandle; state(): GuestState; subscribe(fn: (s: GuestState) => void): () => void; close(): void }
/**
 * Turns the client's decoded events into the guest reducer's state. The view starts at the first frame it has (what was said before this
 * person joined is fetched first, when the host keeps history for them) and goes on in order; a frame that is not sent to this person leaves
 * a gap that is passed after a short wait. Frames that cannot be read never reach here (the client counts them).
 */
export function bridge(handle: SessionHandle): SessionConnection {
  let st = initialGuestState({ member: handle.me.id, slot: handle.me.slot, role: handle.me.role as 'host' | 'editor' | 'viewer' }); const subs = new Set<(s: GuestState) => void>();
  const set = (s: GuestState): void => { st = s; for (const f of [...subs]) f(s); };
  const feed = new TailFeed<DecodedFrame>((frames) => { let s = st; for (const g of frames) s = reduceGuestState(s, g); if (s !== st) set(withPeople({ ...s })); });
  const offAny = handle.onAny((e) => { if (!e.seq) return; feed.push({ v: 1, t: 'event', id: e.id, sid: handle.id, from: e.from, ts: e.ts, k: e.kind, seq: e.seq, ...(e.p ? { p: e.p } : {}), ...(e.secret ? { secret: e.secret } : {}) } as unknown as DecodedFrame); }, { replay: true });
  const phaseOf = (s: string): GuestState['phase'] => (s === 'live' ? (st.roster.length ? 'live' : 'connecting') : s === 'waiting_for_key' ? 'waiting_for_key' : s === 'reconnecting' ? 'reconnecting' : s === 'ended' ? 'ended' : st.phase);
  const offState = handle.on('state', (s) => set({ ...st, phase: phaseOf(s) }));
  const offEnded = handle.on('ended', (e) => set({ ...st, phase: e.code === 4403 ? 'kicked' : 'ended' })); const offRemoved = handle.on('removed', () => set({ ...st, phase: 'kicked' }));
  // The people come from the client's signed roster (the server's own roster frames carry no sequence number, so the transcript never holds them).
  const people = (): GuestState['roster'] => handle.roster().map((m) => ({ id: m.id, name: m.name || 'Someone', slot: m.slot, role: m.role, connected: m.online !== false }));
  const withPeople = (s: GuestState): GuestState => { const roster = people(); if (!roster.length) return s; const host = roster.find((m) => m.role === 'host')?.id; return { ...s, roster, ...(host ? { hostId: host } : {}) }; };
  const offRoster = handle.on('roster', () => set(withPeople({ ...st })));
  set(withPeople({ ...st, phase: handle.state === 'live' ? 'live' : phaseOf(handle.state) })); // the client may be live, or waiting for the host's key, before this runs
  let timer: ReturnType<typeof setTimeout> | undefined; let closed = false;
  void Promise.race([handle.history.fetch(0), new Promise<number>((r) => { timer = setTimeout(() => r(0), 1500); })]).then(() => undefined, () => undefined).then(() => new Promise<void>((r) => { timer = setTimeout(r, 150); })).then(() => { if (!closed) feed.release(); });
  return { handle, state: () => st, subscribe: (f) => { subs.add(f); f(st); return () => { subs.delete(f); }; }, close: () => { closed = true; if (timer) clearTimeout(timer); feed.stop(); offAny(); offState(); offEnded(); offRemoved(); offRoster(); void (handle as unknown as { leave?: () => Promise<void> }).leave?.(); } };
}
/** Plain `ws://` is allowed only for a backend running on this computer (development); everything else must be `wss://`. */
export const isLoopback = (u: string): boolean => { try { const h = new URL(u).hostname; return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'; } catch { return false; } };
export async function connectSession(o: ConnectOptions): Promise<SessionConnection> {
  await initCrypto(); const keychain = memoryKeychain(); const device = new DeviceKeyStore(keychain, o.deviceId); await device.getOrCreatePublicKeys(); /* the keys live in this page only */
  const http = createHttpClient({ baseUrl: o.apiBase, getAccessToken: async () => (await o.getAccessToken()) ?? '', userAgent: defaultUserAgent(o.version ?? '0.1.0', 'centcom-web') });
  const client = createSessionClient({ http: http as never, crypto: { device, trust: new TrustStore({ read: async () => undefined, write: async () => undefined } as never) }, deviceId: o.deviceId, clientInfo: { name: 'centcom-web', version: o.version ?? '0.1.0', contract: '1.2.0' }, wsFactory: browserWsFactory(), ...(o.relayUrl ? { relayUrl: o.relayUrl } : {}), fetch: (i, n) => fetch(i, n), allowPlainWs: isLoopback(o.apiBase) });
  if (o.share) return bridge(await client.joinViaShareLink({ token: o.share.token, displayName: o.share.displayName, fragment: o.share.fragment }));
  return bridge(await client.joinSession({ sessionId: o.sessionId, ...(o.inviteToken && o.inviteSecret ? { inviteToken: o.inviteToken, inviteSecret: o.inviteSecret } : {}) }));
}
