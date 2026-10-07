/** Routes tool-permission asks to the people who can decide them (CT-WS-SESSION-EVENTS approval.*), remotely and locally. */
import { newIdGenerator } from '@centcom/protocol';
import { TypedEmitter } from '../relay/emitter.js';
import type { SessionHandle } from '../session/client.js';
import type { DecodedEvent } from '../session/types.js';
import { sendDecision, type PendingApproval } from './approver.js';
import { authorize } from './authorize.js';
import { MAX_WAIT_MS, sendRequest, type ApprovalOutcome, type ApprovalRequest, type Pending, type Scope } from './requester.js';

export interface ApprovalSink { apply(o: { agentId: string; approvalId: string; outcome: ApprovalOutcome }): void }
export interface RouterClock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: never): void }
export interface RouterEvents {
  request: [PendingApproval]; 'awaiting-approval': [{ agentId: string; approvalId: string }]; 'approval-resolved': [{ agentId?: string; approvalId: string; outcome: ApprovalOutcome }];
  ignored: [{ approvalId: string; reason: string; from: string }]; expired: [{ approvalId: string }];
}
export interface RouterOptions { clock: RouterClock; ids?: { next(prefix: 'apr'): string }; maxWaitMs?: number; sink?: ApprovalSink; /** workspace owners and admins present in the session (the roster does not carry workspace roles) */ owners?: () => ReadonlySet<string>; warn?: (msg: string, ctx?: Record<string, unknown>) => void }
const RISK = new Set(['low', 'medium', 'high']); const APPROVERS = new Set(['host', 'owner', 'any_editor']); const SCOPES = new Set(['once', 'session', 'always']); const DECISIONS = new Set(['approve', 'deny']);
const MAX_DECIDED = 2000;

export class ApprovalRouter extends TypedEmitter<RouterEvents> {
  private readonly mine = new Map<string, Pending & { agentId: string }>(); private readonly theirs = new Map<string, PendingApproval & { expiresAtMs: number; timer: unknown; requester: string }>(); private readonly decided = new Set<string>();
  private readonly ids: { next(prefix: 'apr'): string }; private readonly maxWait: number; private sink?: ApprovalSink; private readonly offs: (() => void)[] = [];
  constructor(private readonly session: SessionHandle, private readonly o: RouterOptions) {
    super(); this.maxWait = Math.min(o.maxWaitMs ?? MAX_WAIT_MS, MAX_WAIT_MS); this.sink = o.sink;
    this.ids = o.ids ?? newIdGenerator({ now: () => Date.now(), random: (n) => crypto.getRandomValues(new Uint8Array(n)) }); this.offs.push(session.onAny((e) => this.onEvent(e), { replay: true }));
  }
  setSink(s: ApprovalSink): void { this.sink = s; }
  dispose(): void { for (const f of this.offs.splice(0)) f(); for (const p of this.mine.values()) this.o.clock.clearTimeout(p.timer as never); for (const p of this.theirs.values()) this.o.clock.clearTimeout(p.timer as never); this.mine.clear(); this.theirs.clear(); }
  pending(): PendingApproval[] { return [...this.theirs.values()].map(({ expiresAtMs: _e, timer: _t, requester: _r, ...p }) => { void _e; void _t; void _r; return p; }); }

  /* ------------------------------------------------------------- asking */
  /** Ask. Resolves with the first valid decision, `expired` at the deadline, or a deny if the request could not be sent. */
  request(r: ApprovalRequest): Promise<ApprovalOutcome> {
    const approvalId = this.ids.next('apr'); const ttl = Math.max(1000, Math.min(r.ttlMs ?? this.maxWait, this.maxWait)); const expiresAtMs = this.o.clock.now() + ttl;
    return new Promise<ApprovalOutcome>((resolve) => {
      const done = (o: ApprovalOutcome): void => { const p = this.mine.get(approvalId); if (!p) return; this.o.clock.clearTimeout(p.timer as never); this.mine.delete(approvalId); this.markDecided(approvalId); this.finish(r.agentId, approvalId, o); resolve(o); };
      const timer = this.o.clock.setTimeout(() => { if (!this.mine.has(approvalId)) return; this.emit('expired', { approvalId }); void sendDecision(this.session, approvalId, { decision: 'deny', scope: 'once', reason: 'expired' }).catch(() => undefined); done({ decision: 'expired', scope: 'once', reason: 'expired' }); }, ttl);
      this.mine.set(approvalId, { approvalId, agentId: r.agentId, expiresAtMs, resolve: done, timer, approver: r.approver, requester: this.session.me.id });
      this.emit('awaiting-approval', { agentId: r.agentId, approvalId });
      sendRequest(this.session, approvalId, r, new Date(expiresAtMs).toISOString()).catch((e) => { this.o.warn?.('approval.request_not_sent', { code: (e as { code?: string }).code }); done({ decision: 'deny', scope: 'once', reason: 'not_sent' }); });
    });
  }
  /** Stop waiting for an answer (the agent was stopped). The outcome is a deny; the tool does not run. */
  cancel(approvalId: string): void { this.mine.get(approvalId)?.resolve({ decision: 'deny', scope: 'once', reason: 'canceled' }); }

  /* ------------------------------------------------------------- answering */
  /** Answer a request we were shown. The relay and the other members check our right to; we check too, so a refusal is clear. */
  async decide(approvalId: string, d: { decision: 'approve' | 'deny'; scope: Scope; reason?: string }): Promise<void> {
    const p = this.theirs.get(approvalId); if (!p) throw new Error('That request is not waiting for an answer here.');
    const v = authorize({ decider: this.session.roster().find((m) => m.id === this.session.me.id) ?? { ...this.session.me }, requester: p.requester, approver: p.approver, policy: this.session.policy, hostId: this.session.roster().find((m) => m.role === 'host')?.id, owners: this.o.owners?.() ?? new Set() });
    if (!v.ok) throw new Error('You are not allowed to answer this request.');
    await sendDecision(this.session, approvalId, d);
  }

  /* ------------------------------------------------------------- hearing */
  private onEvent(e: DecodedEvent): void {
    if (e.kind === 'approval.request') this.onRequest(e); else if (e.kind === 'approval.decision') this.onDecision(e);
  }
  private onRequest(e: DecodedEvent): void {
    const p = e.p ?? {}; const id = typeof p.approval_id === 'string' ? p.approval_id : ''; if (!id || !RISK.has(String(p.risk)) || !APPROVERS.has(String(p.approver)) || typeof p.agent_id !== 'string') { this.emit('ignored', { approvalId: id, reason: 'malformed', from: e.from }); return; }
    if (e.from === this.session.me.id || this.mine.has(id)) return; /* our own, echoed back */ if (this.theirs.has(id) || this.decided.has(id)) return; /* a resend or a replay */
    const expiresAtMs = Math.min(Date.parse(String(p.expires_at)), this.o.clock.now() + this.maxWait); if (!Number.isFinite(expiresAtMs)) { this.emit('ignored', { approvalId: id, reason: 'bad_expiry', from: e.from }); return; } if (expiresAtMs <= this.o.clock.now()) { this.markDecided(id); return; }
    const entry: PendingApproval = { approvalId: id, agentId: p.agent_id, risk: p.risk as PendingApproval['risk'], expiresAt: new Date(expiresAtMs).toISOString(), approver: String(p.approver), summary: String(e.secret?.summary ?? ''), ...(typeof e.secret?.command === 'string' ? { command: e.secret.command } : {}), ...(typeof e.secret?.cwd === 'string' ? { cwd: e.secret.cwd } : {}), from: e.from };
    const timer = this.o.clock.setTimeout(() => { if (this.theirs.delete(id)) { this.markDecided(id); this.emit('expired', { approvalId: id }); } }, Math.max(0, expiresAtMs - this.o.clock.now()));
    this.theirs.set(id, { ...entry, expiresAtMs, timer, requester: e.from }); this.emit('request', entry);
  }
  private onDecision(e: DecodedEvent): void {
    const p = e.p ?? {}; const id = typeof p.approval_id === 'string' ? p.approval_id : ''; const ignore = (reason: string) => { this.o.warn?.('approval.decision_ignored', { reason }); this.emit('ignored', { approvalId: id, reason, from: e.from }); };
    if (!DECISIONS.has(String(p.decision)) || !SCOPES.has(String(p.scope))) return ignore('malformed');
    const mine = this.mine.get(id); const theirs = this.theirs.get(id); if (!mine && !theirs) return ignore(this.decided.has(id) ? 'already_decided' : 'unknown_approval');
    const requester = mine ? mine.requester : theirs!.requester; const approver = mine ? mine.approver : theirs!.approver;
    const v = authorize({ decider: this.session.roster().find((m) => m.id === e.from), requester, approver, policy: this.session.policy, hostId: this.session.roster().find((m) => m.role === 'host')?.id, owners: this.o.owners?.() ?? new Set() }); if (!v.ok) return ignore(v.reason);
    const outcome: ApprovalOutcome = { decision: p.decision as 'approve' | 'deny', scope: p.scope as Scope, by: e.from, ...(typeof e.secret?.reason === 'string' ? { reason: e.secret.reason } : {}) };
    if (mine) { mine.resolve(outcome); return; }
    const t = this.theirs.get(id)!; this.o.clock.clearTimeout(t.timer as never); this.theirs.delete(id); this.markDecided(id); this.emit('approval-resolved', { agentId: t.agentId, approvalId: id, outcome });
  }
  private finish(agentId: string, approvalId: string, outcome: ApprovalOutcome): void { try { this.sink?.apply({ agentId, approvalId, outcome }); } catch { this.o.warn?.('approval.sink_failed'); } this.emit('approval-resolved', { agentId, approvalId, outcome }); }
  private markDecided(id: string): void { this.decided.add(id); if (this.decided.size > MAX_DECIDED) this.decided.delete(this.decided.values().next().value as string); }
}
