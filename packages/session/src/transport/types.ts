/** One way to talk to a session, whether it is hosted, on the LAN or in this process. */
import type { ClosedInfo, FrameLink, RelayEvents, Welcome } from '@centcom/net';
import type { Frame } from '@centcom/protocol';
export interface TransportCapabilities { durableHistory: boolean; restSnapshots: boolean; lanSnapshots: boolean; entitlements: boolean; failover: boolean; auditLog: boolean; lanUpgrade: boolean; maxMembers: number }
export type TransportEvents = { welcome: [Welcome]; frame: [Frame]; notice: [Record<string, unknown>]; link: ['online' | 'reconnecting' | 'offline']; closed: [ClosedInfo]; protocol_warning: [{ reason: string }] };
export interface SessionTransport extends Omit<FrameLink, 'on'> {
  readonly kind: 'relay' | 'lan' | 'local'; readonly capabilities: TransportCapabilities;
  connect(): Promise<Welcome>; close(code?: number): Promise<void>;
  on<K extends 'welcome' | 'frame' | 'link' | 'closed'>(ev: K, fn: (...a: RelayEvents[K]) => void): () => void;
  on<K extends keyof TransportEvents>(ev: K, fn: (...a: TransportEvents[K]) => void): () => void;
}
export type TransportTarget =
  | { kind: 'relay'; sessionId: string; inviteSecret?: string }
  | { kind: 'lan'; host: string; port: number; /** the session id (from discovery or typed in); needed to pair */ sessionId?: string; code?: string; expectedFingerprint?: string; reconnectToken?: string }
  | { kind: 'local'; server?: import('@centcom/lan').LanHostServer };
