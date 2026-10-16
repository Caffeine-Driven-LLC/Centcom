/**
 * Branch mode, "ask my teammates" (C061): a permission question of this person's agent goes to the session as an approval request
 * as well as to this screen. The first answer wins: a teammate's allowed decision resolves the local question, an answer given here
 * withdraws the request. Questions of teammates' agents arrive in `waiting()` for the fleet panel and are answered with `decide`.
 */
import { ApprovalRouter, type PendingApproval, type SessionHandle } from '@centcom/net';
import type { AppController } from '../controller.js';

export type Approver = 'host' | 'owner' | 'any_editor';
const RISK = new Set(['low', 'medium', 'high']);
const real = { now: () => Date.now(), setTimeout: (f: () => void, ms: number) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, clearTimeout: (h: never) => clearTimeout(h as unknown as NodeJS.Timeout) };

export class RemoteApprovals {
  readonly router: ApprovalRouter; private readonly asked = new Map<string, string>(); private off?: () => void; private on = true;
  constructor(private readonly ctl: AppController, handle: SessionHandle, private readonly o: { approver?: Approver; owners?: () => ReadonlySet<string>; onChange?(): void; agentId(): string } ) {
    this.router = new ApprovalRouter(handle, { clock: real, ...(o.owners ? { owners: o.owners } : {}) });
    this.router.on('request', () => o.onChange?.()); this.router.on('approval-resolved', () => o.onChange?.()); this.router.on('expired', () => o.onChange?.());
  }
  start(): void { this.off = this.ctl.store.subscribe(() => this.scan()); this.scan(); }
  stop(): void { this.off?.(); this.router.dispose(); }
  setEnabled(on: boolean): void { this.on = on; }
  /** Questions of teammates' agents that this person may answer. */
  waiting(): PendingApproval[] { return this.router.pending(); }
  decide(id: string, d: { decision: 'approve' | 'deny'; scope?: 'once' | 'session' | 'always'; reason?: string }): Promise<void> { return this.router.decide(id, { scope: 'once', ...d }); }
  private scan(): void {
    const live = new Set(this.ctl.state.approvals.map((a) => a.req.approval_id));
    for (const [local, remote] of [...this.asked]) if (!live.has(local)) { this.asked.delete(local); this.router.cancel(remote); }
    if (!this.on) return;
    for (const a of this.ctl.state.approvals) {
      const id = a.req.approval_id; if (this.asked.has(id)) continue; this.asked.set(id, '');
      // the router emits awaiting-approval while request() runs, so the listener comes first
      const stop = this.router.on('awaiting-approval', (e) => { if (this.asked.get(id) === '') this.asked.set(id, e.approvalId); });
      const req = this.router.request({ agentId: this.o.agentId(), risk: RISK.has(a.req.risk) ? a.req.risk as 'low' : 'medium', approver: this.o.approver ?? 'any_editor', summary: String(a.req.summary ?? a.req.tool).slice(0, 500), ...(a.req.command ? { command: a.req.command.slice(0, 2000) } : {}), ...(a.req.cwd ? { cwd: a.req.cwd } : {}), ttlMs: a.expiresAt ? Math.max(1000, a.expiresAt - Date.now()) : undefined });
      stop();
      void req.then((o) => { this.asked.delete(id); if (o.decision === 'approve' || o.decision === 'deny') this.ctl.answerApprovalById(id, o.decision, o.scope === 'always' ? 'session' : o.scope); });
    }
  }
}
