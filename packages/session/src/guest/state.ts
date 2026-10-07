/** What a guest renders: an immutable copy of the remote session (lane C076). */
import type { Frame } from '@centcom/protocol';
export type Phase = 'connecting' | 'waiting_for_key' | 'live' | 'reconnecting' | 'paused' | 'ended' | 'kicked';
export type Role = 'host' | 'editor' | 'viewer';
export interface RosterEntry { id: string; name: string; slot: number; role: Role; connected: boolean }
export interface QueueItemView { item: string; submitter: string; state: string; position: number | null; size: number; kind: string; ts: string; agent_id?: string }
export type TranscriptEntry =
  | { kind: 'user'; seq: number; id: string; from: string; ts: string; text: string; queueItem?: string }
  | { kind: 'assistant'; seq: number; id: string; from: string; ts: string; messageId: string; agentId: string; text: string; done: boolean; gap: boolean }
  | { kind: 'system'; seq: number; id: string; from: string; ts: string; level: string; text: string }
  | { kind: 'tool_request'; seq: number; id: string; from: string; ts: string; agentId: string; toolId: string; name: string; summary: string; risk: string }
  | { kind: 'tool_result'; seq: number; id: string; from: string; ts: string; agentId: string; toolId: string; status: string; summary: string }
  | { kind: 'approval'; seq: number; id: string; from: string; ts: string; approvalId: string; agentId: string; risk: string; summary: string; decision?: string; decidedBy?: string }
  | { kind: 'other'; seq: number; id: string; from: string; ts: string; frameKind: string };
export interface ProtocolWarning { seq?: number; kind: string; reason: string }
export interface GuestState {
  phase: Phase; me: { member: string; slot: number; role: Role; muted: boolean }; roster: RosterEntry[]; rosterVersion: number; queue: { version: number; items: QueueItemView[] };
  transcript: TranscriptEntry[]; agents: Record<string, { state: string; owner: string }>; lastSeq: number; warnings: ProtocolWarning[]; hostId?: string;
}
/** A frame after the engine has verified `sig` and opened `ct`; `secret` is the decrypted payload (never logged). */
export type DecodedFrame = Frame & { secret?: Record<string, unknown> | null };
export const SERVER = 'srv'; export const WARNING_RING = 100;
export const initialGuestState = (me: { member: string; slot?: number; role?: Role }): GuestState => ({ phase: 'connecting', me: { member: me.member, slot: me.slot ?? 0, role: me.role ?? 'viewer', muted: false }, roster: [], rosterVersion: 0, queue: { version: 0, items: [] }, transcript: [], agents: {}, lastSeq: 0, warnings: [] });
