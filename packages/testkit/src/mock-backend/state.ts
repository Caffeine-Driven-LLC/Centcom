import type { ErrorCode, Id } from '@centcom/protocol';

export interface MemberRec { id: Id<'mem'>; user: Id<'usr'>; name: string; slot: number; role: 'host' | 'editor' | 'viewer'; device: Id<'dev'>; muted?: boolean; joined: boolean }
export interface QueueItem { item: string; member: string; state: 'queued' | 'approved' | 'running' | 'done'; size: number; kind: string; agent_id?: string; outcome?: string }
export interface Frame { v: 1; t: string; id?: string; sid: string; from?: string; ts?: string; seq?: number; ack?: number; ref?: string; k?: string; p?: Record<string, unknown>; ct?: unknown; sig?: string }
export interface SessionRec {
  id: Id<'ses'>; workspace: Id<'wsp'>; mode: 'command_post' | 'branch'; state: 'pending' | 'live' | 'paused' | 'ended' | 'expired'; name: string; created: string;
  members: Map<string, MemberRec>; nextSeq: number; buffer: Frame[]; seen: Map<string, number>; queue: QueueItem[]; queueVersion: number; policy: { queue_limit: number; locked?: boolean; auto_failover?: boolean; queue_paused?: boolean }; rosterV: number; hostId: string;
}
export interface DeviceCodeRec { device_code: string; user_code: string; state: 'pending' | 'approved' | 'denied'; expiresAt: number; interval: number; lastPoll: number; polls: number; approveAfterPolls: number }
export interface FamilyRec { id: string; user: Id<'usr'>; device: Id<'dev'>; current: string; old: Set<string>; revoked: boolean }
export interface IdemRec { fingerprint: string; status: number; body: unknown; headers: Record<string, string>; at: number }

export interface MockState {
  user: { id: Id<'usr'>; email: string; name: string }; workspace: Id<'wsp'>; ownerMember: Id<'mem'>;
  devices: Map<string, { id: Id<'dev'>; name: string; revoked: boolean }>; revokedTokens: Set<string>; families: Map<string, FamilyRec>; deviceCodes: Map<string, DeviceCodeRec>;
  usedJti: Set<string>; idem: Map<string, IdemRec>; sessions: Map<string, SessionRec>; entitlements: Map<string, Record<string, unknown>>; etags: Map<string, string>; datasets: Map<string, unknown[]>;
  pendingErrors: { code: ErrorCode; retryAfterS?: number }[]; rateLimit?: { remaining: number; retryAfterS: number }; minClient?: string; maintenance: boolean; counters: Map<string, number>;
}
