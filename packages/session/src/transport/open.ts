import { LanHostServer } from '@centcom/lan';
import type { ClientIdent, DeviceKeyStore, Keychain } from '@centcom/net';
import { LanTransport } from './lan-transport.js';
import { LocalTransport } from './local-transport.js';
import { RelayTransport, type SessionRestApi } from './relay-transport.js';
import type { SessionTransport, TransportTarget } from './types.js';
export interface TransportDeps { sessions: SessionRestApi; keychain: Keychain; device: DeviceKeyStore; deviceInfo: { id: string; name: string }; clientInfo: ClientIdent; clock?: ConstructorParameters<typeof LanTransport>[0]['clock']; logger?: ConstructorParameters<typeof LanTransport>[0]['logger']; relayUrl?: string; allowPlainWs?: boolean; getLastSeq?: () => number | null; localServer?: () => LanHostServer }
export function openTransport(target: TransportTarget, deps: TransportDeps): SessionTransport {
  switch (target.kind) {
    case 'relay': return new RelayTransport({ sessionId: target.sessionId, sessions: deps.sessions, clientInfo: deps.clientInfo, relayUrl: deps.relayUrl, getLastSeq: deps.getLastSeq, clock: deps.clock, logger: deps.logger, allowPlainWs: deps.allowPlainWs });
    case 'lan': return new LanTransport({ host: target.host, port: target.port, sessionId: target.sessionId, code: target.code, expectedFingerprint: target.expectedFingerprint, reconnectToken: target.reconnectToken, keychain: deps.keychain, device: deps.device, deviceInfo: deps.deviceInfo, clientInfo: deps.clientInfo, getLastSeq: deps.getLastSeq, clock: deps.clock, logger: deps.logger });
    case 'local': { const server = target.server ?? deps.localServer?.(); if (!server) throw new Error('A local session needs a host server.'); return new LocalTransport(server, deps.getLastSeq); }
  }
}
