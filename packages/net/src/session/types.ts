/** Shapes shared by the session client (lane C057). */
import type { EventKind } from '@centcom/protocol';

export type SessionState = 'connecting' | 'waiting_for_key' | 'live' | 'paused' | 'reconnecting' | 'ended';
export type Role = 'host' | 'editor' | 'viewer';
export interface SessionPolicy { auto_approve?: 'ask' | 'trusted' | 'everyone'; auto_failover?: boolean; locked?: boolean; queue_limit?: number; share_history?: boolean }
export interface DeviceKeysInfo { device: string; x25519: string; ed25519: string; fingerprint?: string; revoked?: boolean }
export interface MemberInfo { id: string; role: Role; slot: number; name?: string; device?: string; keys?: DeviceKeysInfo; /** set when the device's keys differ from the ones trusted before */ keyChanged?: boolean; online?: boolean }
export interface SessionSummary { id: string; name: string; state: string; host: string; workspace: string; region: string; policy: SessionPolicy; created_at: string; member_count?: number; ended_at?: string | null }
export type EventP<_K extends EventKind = EventKind> = Record<string, unknown>;
export type EventSecret<_K extends EventKind = EventKind> = Record<string, unknown>;
export interface DecodedEvent<K extends string = string> { kind: K; seq: number; id: string; from: string; ts: string; p?: Record<string, unknown>; secret?: Record<string, unknown>; verified: true }
export interface SnapshotDoc { fmt: 'centcom.snapshot'; v: 1; seq: number; [k: string]: unknown }
export interface SnapshotMeta { snp: string; seq: number; size: number; sha256: string; kid: string }

/** Everything the session client throws on purpose. `code` is stable; the message is for people and never holds a key, ticket or URL. */
export class SessionError extends Error {
  constructor(readonly code: 'relay_not_included' | 'muted' | 'waiting_for_key' | 'view_only' | 'not_host' | 'no_key' | 'too_large' | 'snapshot_invalid' | 'snapshot_unsupported' | 'ended' | 'bad_link' | 'untrusted_device' | 'timeout', message: string) { super(message); this.name = 'SessionError'; }
}
