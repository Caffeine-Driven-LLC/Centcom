/** The agent owner's side: ask, then wait for the first decision from someone allowed to give it. Anything unclear is a deny. */
import type { SessionHandle } from '../session/client.js';
export type Scope = 'once' | 'session' | 'always'; export type Risk = 'low' | 'medium' | 'high';
export interface ApprovalOutcome { decision: 'approve' | 'deny' | 'expired'; scope: Scope; by?: string; reason?: string }
export interface ApprovalRequest { agentId: string; risk: Risk; approver: 'host' | 'owner' | 'any_editor'; summary: string; command?: string; cwd?: string; ttlMs?: number }
export const MAX_WAIT_MS = 600_000;
export interface Pending { approvalId: string; agentId: string; expiresAtMs: number; resolve(o: ApprovalOutcome): void; timer: unknown; approver: string; requester: string }
/** The frame id carries the approval's ULID, so a resend is the same frame and the relay ignores the replay. */
export const frameIdOfApproval = (apr: string): string => `msg_${apr.slice(4)}`;
export async function sendRequest(session: Pick<SessionHandle, 'sendEvent'>, approvalId: string, r: ApprovalRequest, expiresAtIso: string): Promise<void> {
  await session.sendEvent('approval.request', { id: frameIdOfApproval(approvalId), p: { approval_id: approvalId, agent_id: r.agentId, risk: r.risk, expires_at: expiresAtIso, approver: r.approver }, secret: { summary: r.summary, ...(r.command !== undefined ? { command: r.command } : {}), ...(r.cwd !== undefined ? { cwd: r.cwd } : {}) } });
}
