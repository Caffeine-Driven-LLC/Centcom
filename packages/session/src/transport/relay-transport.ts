/** The hosted relay: a join token for every connection attempt, the ticket sent only in the hello. */
import { RelayClient, type ClientIdent, type RelayClientOptions, type Welcome } from '@centcom/net';
import type { SessionTransport, TransportCapabilities, TransportEvents } from './types.js';
export interface SessionRestApi { joinToken(sessionId: string, caps?: string[]): Promise<{ ticket: string; relay_url: string }> }
export interface RelayTransportOptions { sessionId: string; sessions: SessionRestApi; clientInfo: ClientIdent; relayUrl?: string; getLastSeq?: () => number | null; clock?: RelayClientOptions['clock']; wsFactory?: RelayClientOptions['wsFactory']; logger?: RelayClientOptions['logger']; allowPlainWs?: boolean }
const BASE: TransportCapabilities = { durableHistory: true, restSnapshots: true, lanSnapshots: false, entitlements: true, failover: true, auditLog: true, lanUpgrade: false, maxMembers: 50 };
export class RelayTransport implements SessionTransport {
  readonly kind = 'relay' as const; private readonly client: RelayClient; joinTokens = 0;
  constructor(o: RelayTransportOptions) {
    this.client = new RelayClient({ url: o.relayUrl ?? 'wss://relay.centcom.dev/v1/ws', sessionId: o.sessionId, clientInfo: o.clientInfo, getLastSeq: o.getLastSeq ?? (() => null), clock: o.clock, wsFactory: o.wsFactory, logger: o.logger, allowPlainWs: o.allowPlainWs,
      getTicket: async () => { this.joinTokens++; const t = await o.sessions.joinToken(o.sessionId, ['resume']); return { ticket: t.ticket, url: t.relay_url }; } });
  }
  get capabilities(): TransportCapabilities { return { ...BASE, lanUpgrade: false }; }
  get welcome(): Welcome | null { return this.client.welcome; } get state(): string { return this.client.state; }
  connect(): Promise<Welcome> { return this.client.connect(); } close(code?: number): Promise<void> { return this.client.close(code); } reconnect(): void { this.client.reconnect(); }
  send(f: Parameters<RelayClient['send']>[0]): Promise<void> { return this.client.send(f); }
  on(ev: string, fn: (...a: never[]) => void): () => void { return (this.client.on as (e: string, f: (...a: never[]) => void) => () => void)(ev, fn); }
}
