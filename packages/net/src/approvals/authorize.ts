/** Who may answer an approval request. The live roster decides, never the frame. */
import type { MemberInfo, SessionPolicy } from '../session/types.js';
export type ApproverKind = 'host' | 'owner' | 'any_editor';
export interface AuthInput { decider: MemberInfo | undefined; requester: string; approver: ApproverKind | string; policy: SessionPolicy & { approvers?: string[] }; hostId: string | undefined; /** members who are workspace owners or admins */ owners: ReadonlySet<string> }
export type Verdict = { ok: true } | { ok: false; reason: 'unknown_member' | 'viewer' | 'requester' | 'not_allowed' };
export function authorize(a: AuthInput): Verdict {
  const d = a.decider; if (!d) return { ok: false, reason: 'unknown_member' }; if (d.role === 'viewer') return { ok: false, reason: 'viewer' };
  const isHost = d.id === a.hostId || d.role === 'host'; if (isHost) return { ok: true }; /* the host always, even for its own agent */
  if (d.id === a.requester) return { ok: false, reason: 'requester' }; /* nobody else approves their own request */
  if ((a.policy.approvers ?? []).includes(d.id)) return { ok: true };
  if (a.approver === 'any_editor') return d.role === 'editor' ? { ok: true } : { ok: false, reason: 'not_allowed' };
  if (a.approver === 'owner') return a.owners.has(d.id) ? { ok: true } : { ok: false, reason: 'not_allowed' };
  return { ok: false, reason: 'not_allowed' };
}
