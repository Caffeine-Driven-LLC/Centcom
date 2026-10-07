/** What handoff and pair mode need from a session. The session client (`SessionHandle`) fits through `fromSessionHandle`; tests use a fake. */
export type MemberId = string; export type AgentId = string; export type Role = 'host' | 'editor' | 'viewer'; export type Unsubscribe = () => void;
export interface HandoffFrame { kind: string; seq: number; from: string; p?: Record<string, unknown>; secret?: Record<string, unknown> }
export interface MemberLite { id: MemberId; role: Role; connected: boolean; /** true when the member does not hold every key epoch yet */ missingKeys?: boolean }
export interface HandoffClock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: never): void }
export interface HandoffSession {
  readonly me: MemberId; readonly clock: HandoffClock; role(): Role; members(): MemberLite[];
  /** Sends a frame and resolves with its sequence number once it was sequenced; rejects with an error whose `code` says why not (`forbidden`...). */
  send(kind: string, body: { p?: Record<string, unknown>; secret?: Record<string, unknown> }): Promise<{ id: string; seq: number }>;
  onFrame(fn: (f: HandoffFrame) => void): Unsubscribe;
}
export interface Observable<T> { subscribe(fn: (v: T) => void): Unsubscribe }
export type HandoffResult = { ok: true; newHost: MemberId } | { ok: false; code: 'forbidden' | 'not_editor' | 'timeout' | 'superseded' | 'keys_missing' };
export type HandoffProgress = 'requested' | 'accepted' | 'done' | 'failed';
export interface Selection { path?: string; line: number; col: number; selEndLine: number; selEndCol: number }
