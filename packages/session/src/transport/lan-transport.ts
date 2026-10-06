/** A LAN host: plain `ws://`, the stored reconnect token as the ticket, and a one-time pairing with the code on the first connect. */
import { WebSocket } from 'ws';
import { RelayClient, type ClientIdent, type DeviceKeyStore, type Keychain, type Welcome } from '@centcom/net';
import { guestPair, loadGuestToken, type PairingTrustStore, type TextChannel } from '@centcom/lan';
import type { SessionTransport, TransportCapabilities, TransportEvents } from './types.js';

export interface LanTransportOptions { host: string; port: number; sessionId?: string; code?: string; expectedFingerprint?: string; reconnectToken?: string; keychain: Keychain; device: DeviceKeyStore; deviceInfo: { id: string; name: string }; clientInfo: ClientIdent; trust?: PairingTrustStore; getLastSeq?: () => number | null; clock?: ConstructorParameters<typeof RelayClient>[0]['clock']; logger?: ConstructorParameters<typeof RelayClient>[0]['logger'] }
const CAPS: TransportCapabilities = { durableHistory: false, restSnapshots: false, lanSnapshots: true, entitlements: false, failover: false, auditLog: false, lanUpgrade: false, maxMembers: 8 };
export const lanUrl = (host: string, port: number): string => `ws://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`;

/** A pairing socket as the TextChannel the pairing code speaks. */
function wsChannel(ws: WebSocket): TextChannel { const msg: ((t: string) => void)[] = []; const cl: ((c: number) => void)[] = []; ws.on('message', (d) => { for (const f of msg) f(d.toString()); }); ws.on('close', (c) => { for (const f of cl) f(c); }); return { send: (t) => ws.send(t), onMessage: (f) => { msg.push(f); }, onClose: (f) => { cl.push(f); }, close: (c) => { try { ws.close(c); } catch { /* already closed */ } } }; }
export class LanTransport implements SessionTransport {
  readonly kind = 'lan' as const; private client?: RelayClient; paired = false; pairingFrames = 0; private connecting?: Promise<Welcome>;
  constructor(private readonly o: LanTransportOptions) {}
  get capabilities(): TransportCapabilities { return { ...CAPS, lanUpgrade: this.client?.welcome?.caps.includes('lan.upgrade') ?? false }; }
  get welcome(): Welcome | null { return this.client?.welcome ?? null; } get state(): string { return this.client?.state ?? 'idle'; }
  private pending: { ev: string; fn: (...a: never[]) => void }[] = [];
  /** Pairs first when there is no token and a code, then connects with the token. */
  connect(): Promise<Welcome> { return (this.connecting ??= this.start()); }
  private async start(): Promise<Welcome> {
    let token = this.o.reconnectToken ?? (this.o.sessionId ? await loadGuestToken(this.o.keychain, this.o.sessionId) : undefined);
    if (!token && this.o.code) { token = await this.pair(); }
    if (!token) throw new Error('This LAN session needs a pairing code the first time you join.');
    const tk = token; this.client = new RelayClient({ url: lanUrl(this.o.host, this.o.port), allowPlainWs: true, sessionId: this.o.sessionId ?? 'ses_00000000000000000000000000', clientInfo: this.o.clientInfo, getLastSeq: this.o.getLastSeq ?? (() => null), clock: this.o.clock, logger: this.o.logger, getTicket: async () => ({ ticket: tk }) });
    for (const p of this.pending.splice(0)) (this.client.on as (e: string, f: (...a: never[]) => void) => unknown)(p.ev, p.fn);
    return this.client.connect();
  }
  private async pair(): Promise<string> {
    const ws = new WebSocket(lanUrl(this.o.host, this.o.port), 'centcom.v1'); await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    const ch = wsChannel(ws); const count = ch.send; ch.send = (t) => { this.pairingFrames++; count(t); };
    try { const r = await guestPair({ channel: ch, code: this.o.code!, device: this.o.device, deviceInfo: this.o.deviceInfo, hostSessionId: this.o.sessionId, expectedFingerprint: this.o.expectedFingerprint, keychain: this.o.keychain, trust: this.o.trust }); this.paired = true; return r.reconnectToken; } finally { try { ws.close(); } catch { /* already closed */ } }
  }
  async close(code?: number): Promise<void> { await this.client?.close(code); }
  reconnect(): void { this.client?.reconnect(); }
  send(f: Parameters<RelayClient['send']>[0]): Promise<void> { if (!this.client) return Promise.reject(new Error('not connected')); return this.client.send(f); }
  on(ev: string, fn: (...a: never[]) => void): () => void { if (this.client) return (this.client.on as (e: string, f: (...a: never[]) => void) => () => void)(ev, fn); this.pending.push({ ev, fn: fn as never }); return () => { this.pending = this.pending.filter((p) => p.fn !== (fn as never)); }; }
}
