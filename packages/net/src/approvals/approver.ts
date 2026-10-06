/** The approver's side: what is waiting for me, and my answer. */
import type { SessionHandle } from '../session/client.js';
import type { Risk, Scope } from './requester.js';
export interface PendingApproval { approvalId: string; agentId: string; risk: Risk; expiresAt: string; approver: string; summary: string; command?: string; cwd?: string; from: string }
export async function sendDecision(session: Pick<SessionHandle, 'sendEvent'>, approvalId: string, d: { decision: 'approve' | 'deny'; scope: Scope; reason?: string }): Promise<void> {
  await session.sendEvent('approval.decision', { p: { approval_id: approvalId, decision: d.decision, scope: d.scope }, secret: d.reason ? { reason: d.reason } : {} });
}
