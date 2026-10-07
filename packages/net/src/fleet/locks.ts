/** Shared file locks: the path never leaves the machine in the clear; others see only its keyed hash. */
import { pathHmac } from '../crypto/path-mac.js';
import type { KeyRing } from '../crypto/keyring.js';
export interface LockBackend {
  /** a lock event another member's agent caused (or the relay): the local lock client updates its table */ onRemoteLock?(evt: { action: string; path_hmac: string; agent_id: string; ttl_ms?: number }): void;
  /** our own lock ended on the relay: the local lock client lets go of it */ release(path: string, agentId: string): void | Promise<void>;
}
/** The path hash for this session: the current epoch's key, so different sessions give different values. */
export function hmacFor(ring: KeyRing, path: string): { hmac: string; kid: string } { const { kid } = ring.current(); return { hmac: pathHmac(ring, kid, path), kid }; }
/** The shape the local lock client (lane C018) publishes through. */
export interface LockTransport { publish(p: { clear: { action: 'acquire' | 'release'; path_hmac: string; agent_id: string; ttl_ms?: number }; secret: { path: string } }): void; ready?(): boolean }
