/** Who may answer an approval request (CT-WS-SESSION-EVENTS bounds table): the host, members the policy names, and the roles the request names. The host's engine sees only the clear routing fields. */
import type { Role } from './authority.js';
export interface ApprovalRecord { approvalId: string; requester: string; approver: string; expiresAtMs: number; decided: boolean }
export class ApprovalBook {
  private m = new Map<string, ApprovalRecord>();
  constructor(private readonly now: () => number) {}
  open(r: ApprovalRecord): void { this.m.set(r.approvalId, r); if (this.m.size > 5000) this.m.delete(this.m.keys().next().value as string); }
  get(id: string): ApprovalRecord | undefined { return this.m.get(id); }
  /** `ok`, or why not. The first decision wins; a later one is `decided`. */
  check(id: string, from: string, role: Role, approvers: readonly string[]): 'ok' | 'unknown' | 'decided' | 'expired' | 'forbidden' {
    const r = this.m.get(id); if (!r) return 'unknown'; if (r.decided) return 'decided'; if (this.now() > r.expiresAtMs) return 'expired';
    if (role === 'viewer') return 'forbidden'; if (role === 'host') return 'ok'; if (from === r.requester) return 'forbidden'; if (approvers.includes(from)) return 'ok'; if (r.approver === 'any_editor' && role === 'editor') return 'ok'; return 'forbidden';
  }
  markDecided(id: string): void { const r = this.m.get(id); if (r) r.decided = true; }
}
