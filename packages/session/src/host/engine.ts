/** The host's authority for a LAN session: what the hosted relay does, done by the host (CT-WS-QUEUE, CT-WS-CONTROL, CT-RBAC). It plugs into the LAN server as its frame interceptor, so every frame, the host's own included, goes through the same code. It never reads `ct`. */
import { parseEventPayload, type Frame } from '@centcom/protocol';
import type { ConnectedMember, FrameInterceptor, HostMember, LanHostServer, ProblemBody } from '@centcom/lan';
import type { ReconnectTokens } from '@centcom/lan';
import { TypedEmitter } from '@centcom/net';
import { ApprovalBook } from './approval-router.js';
import { AGENT_KINDS, SERVER_ONLY, authorizeFrame, type Mode, type Role } from './authority.js';
import { checkControl } from './control-enforcer.js';
import { SNAPSHOT_FRAMES, SNAPSHOT_MS, type SequencedFrame, type SessionPersistence } from './history.js';
import { LockArbiter, type Clock } from './lock-arbiter.js';
import { DEFAULT_LIMIT, QueueMachine } from './queue-machine.js';
import { HostRoster } from './roster.js';

export interface SessionPolicy { auto_approve: 'ask' | 'trusted' | 'everyone'; share_history: boolean; queue_limit: number; locked?: boolean; auto_failover?: boolean; trusted?: string[]; approvers?: string[]; queue_paused?: boolean }
export interface EngineOptions { server: LanHostServer; persistence: SessionPersistence; policy?: Partial<SessionPolicy>; mode?: Mode; tokens: ReconnectTokens; clock: Clock; snapshotBuilder?: () => Promise<Uint8Array>; initialEpoch?: number; logger?: { warn(m: string, c?: Record<string, unknown>): void; info?(m: string, c?: Record<string, unknown>): void }; hostMember?: HostMember }
export interface EngineEvents { 'member-joined': [{ id: string }]; 'member-left': [{ id: string; code: string }]; 'queue-changed': [unknown]; 'approval-request': [{ approvalId: string; requester: string }]; 'protocol-violation': [{ member: string; kind: string }]; ended: [{ code: string }]; denied: [{ member: string; kind: string; code: string }] }
const MAX_CT = 196_608; const reject = (code: string, status = 403, extra: Record<string, unknown> = {}): { reject: ProblemBody } => ({ reject: { code, status, title: code, ...extra } });

export class HostSessionEngine extends TypedEmitter<EngineEvents> implements FrameInterceptor {
  private readonly server: LanHostServer; readonly roster: HostRoster; private readonly qm: QueueMachine; private readonly locks: LockArbiter; private readonly book: ApprovalBook; private policy_: SessionPolicy; private readonly muted = new Map<string, number>(); private muteTimers = new Map<string, unknown>();
  private readonly mode: Mode; private epoch: number; private framesSinceSnapshot = 0; private snapTimer?: unknown; private snapshotting = false; private ended = false; private readonly stateAt = new Map<string, number[]>(); private readonly sid: string;
  constructor(private readonly o: EngineOptions) {
    super(); this.server = o.server; this.mode = o.mode ?? 'command_post'; this.epoch = o.initialEpoch ?? 1; this.sid = (o.server as unknown as { o: { sessionId: string } }).o.sessionId;
    this.policy_ = { auto_approve: 'ask', share_history: true, queue_limit: DEFAULT_LIMIT, ...o.policy }; const host = o.hostMember ?? (o.server as unknown as { o: { hostMember: HostMember } }).o.hostMember; this.roster = new HostRoster(host);
    this.qm = new QueueMachine(() => this.policy_.queue_limit); this.locks = new LockArbiter(o.clock, (l) => { this.server.broadcast({ t: 'event', k: 'file.lock', p: { action: 'expire', path_hmac: l.pathHmac, agent_id: l.agentId } } as never); }); this.book = new ApprovalBook(() => o.clock.now());
  }
  async start(): Promise<void> {
    this.server.setInterceptor(this); this.server.setHooks({ connected: (m, first) => this.onConnected(m, first), disconnected: (m) => this.onDisconnected(m), left: (id) => { this.roster.remove(id); this.emit('member-left', { id, code: 'timeout' }); } }); this.server.setSnapshots({ get: () => this.o.persistence.latestSnapshot(this.sid) });
    if (this.o.snapshotBuilder) this.armSnapshotTimer();
  }
  async stop(code: 'done' | 'abandoned' | 'error' = 'done'): Promise<void> {
    if (this.ended) return; this.ended = true; this.server.broadcast({ t: 'control', k: 'control.session_state', p: { state: 'ended' } } as never); this.o.tokens.endSession(); this.locks.stop(); if (this.snapTimer !== undefined) this.o.clock.clearTimeout(this.snapTimer as never); for (const t of this.muteTimers.values()) this.o.clock.clearTimeout(t as never);
    if (this.o.snapshotBuilder) await this.snapshot().catch(() => undefined); await this.server.stop(1000); this.emit('ended', { code });
  }

  /* ------------------------------------------------------------- views */
  queue(): { version: number; items: Record<string, unknown>[] } { return this.qm.view(); } members() { return this.roster.list(); } policy(): SessionPolicy { return { ...this.policy_ }; } headSeq(): number { return this.server.headSeq(); } lockList() { return this.locks.list(); }
  isMuted(member: string): boolean { const u = this.muted.get(member); return u !== undefined && (u === Infinity || this.o.clock.now() < u); }

  /* ------------------------------------------------------------- before a frame is numbered */
  onInbound({ from, frame }: { from: HostMember; frame: Frame }): 'accept' | { reject: ProblemBody } | { replace: Frame[] } {
    if (this.ended) return reject('session_ended', 410); const kind = frame.k ?? ''; const type = frame.t; const role: Role = this.server.roleOf(from.id) ?? from.role;
    if (SERVER_ONLY.has(kind)) { this.emit('protocol-violation', { member: from.id, kind }); return reject('forbidden'); }
    if (authorizeFrame({ role, kind, type, muted: this.isMuted(from.id), locked: this.policy_.locked === true, mode: this.mode }) === 'forbidden') { this.emit('denied', { member: from.id, kind, code: 'forbidden' }); this.o.logger?.warn('host.denied', { kind, member: from.id }); return reject('forbidden'); }
    if (frame.ct && frame.ct.c.length > MAX_CT) return reject('payload_too_large', 413);
    const p = (frame.p ?? {}) as Record<string, unknown>; if (frame.p !== undefined && kind && !parseEventPayload(kind, frame.p).ok && !kind.startsWith('presence.') && AGENT_KINDS.has(kind) === false && !kind.startsWith('queue.') && !kind.startsWith('control.')) { /* unknown or free-form kinds pass; known ones are checked below */ }
    if (kind.startsWith('queue.')) { const r = this.qm.check(kind, from.id, p, { paused: this.policy_.queue_paused === true }); if (!r.ok) return r.noop ? { replace: [] } : reject(r.code); return 'accept'; }
    if (kind.startsWith('control.')) { const r = checkControl(kind, p, this.roster, from.id); if (!r.ok) return reject(r.code); if (kind === 'control.policy' && !parseEventPayload(kind, frame.p).ok) return reject('invalid_frame', 400); return 'accept'; }
    if (kind === 'approval.decision') { const id = String(p.approval_id ?? ''); const v = this.book.check(id, from.id, role, this.policy_.approvers ?? []); if (v === 'ok') return 'accept'; return v === 'unknown' ? reject('not_found', 404) : reject('forbidden'); }
    if (kind === 'file.lock') { const a = String(p.action); const hmac = String(p.path_hmac); const agent = String(p.agent_id); if (a === 'acquire') { const r = this.locks.acquire(hmac, agent, from.id, typeof p.ttl_ms === 'number' && p.ttl_ms > 0 ? p.ttl_ms : 30_000); if (r === 'denied') { this.server.broadcast({ t: 'event', k: 'file.lock', p: { action: 'deny', path_hmac: hmac, agent_id: agent } } as never); return { replace: [] }; } } else if (a === 'release') { if (!this.locks.release(hmac, agent, from.id)) return { replace: [] }; } else return reject('forbidden'); return 'accept'; }
    if (kind === 'agent.state') { const id = String(p.agent_id); const now = this.o.clock.now(); const l = (this.stateAt.get(id) ?? []).filter((t) => now - t < 1000); if (l.length >= 2) return reject('rate_limited', 429); l.push(now); this.stateAt.set(id, l); }
    return 'accept';
  }

  /* ------------------------------------------------------------- after it was numbered and sent */
  onSequenced(f: Frame): void {
    void this.o.persistence.appendFrame(this.sid, f as SequencedFrame).catch(() => this.o.logger?.warn('host.persist_failed')); this.framesSinceSnapshot++; if (this.framesSinceSnapshot >= SNAPSHOT_FRAMES && this.o.snapshotBuilder) void this.snapshot().catch(() => undefined);
    if (f.from === 'srv' || !f.k) return; const from = String(f.from); const p = (f.p ?? {}) as Record<string, unknown>; const kind = f.k;
    if (kind.startsWith('queue.')) { if (this.qm.apply(kind, from, p, String(f.ts))) { if (kind === 'queue.submit') this.autoApprove(from, String(p.item)); this.broadcastQueue(); } return; }
    if (kind.startsWith('control.')) return this.afterControl(kind, from, p);
    if (kind === 'approval.request') { const exp = Date.parse(String(p.expires_at)); this.book.open({ approvalId: String(p.approval_id), requester: from, approver: String(p.approver), expiresAtMs: Number.isFinite(exp) ? exp : this.o.clock.now() + 600_000, decided: false }); this.emit('approval-request', { approvalId: String(p.approval_id), requester: from }); }
    else if (kind === 'approval.decision') this.book.markDecided(String(p.approval_id));
  }
  private autoApprove(from: string, item: string): void {
    const pol = this.policy_; if (pol.queue_paused) return; const role = this.roster.get(from)?.role; const ok = pol.auto_approve === 'everyone' ? role === 'editor' : pol.auto_approve === 'trusted' ? role === 'editor' && (pol.trusted ?? []).includes(from) : false; if (!ok) return;
    if (this.qm.check('queue.approve', from, { item }, { paused: false }).ok) { this.qm.apply('queue.approve', 'srv', { item }, new Date(this.o.clock.now()).toISOString()); this.server.broadcast({ t: 'queue', k: 'queue.approve', p: { item, policy: `auto:${pol.auto_approve}` } } as never); }
  }
  private broadcastQueue(): void { this.server.broadcast({ t: 'queue', k: 'queue.state', p: this.qm.view() } as never); this.emit('queue-changed', this.qm.view()); }
  private broadcastRoster(): void { this.server.broadcast({ t: 'control', k: 'control.roster', p: this.roster.frame() } as never); }
  private afterControl(kind: string, from: string, p: Record<string, unknown>): void {
    const target = typeof p.member === 'string' ? p.member : '';
    switch (kind) {
      case 'control.kick': { const dev = this.roster.deviceOf(target); if (dev) this.o.tokens.revoke(dev); this.locks.dropMember(target); this.server.dropMember(target, 4403); this.roster.remove(target); this.server.broadcast({ t: 'control', k: 'control.member_left', p: { member: target, code: 'kicked' } } as never); this.epoch++; this.server.broadcast({ t: 'control', k: 'control.rotate_key', p: { kid: `k${this.epoch}`, reason: 'member_removed' } } as never); this.emit('member-left', { id: target, code: 'kicked' }); break; }
      case 'control.mute': { const until = typeof p.until === 'string' ? Date.parse(p.until) : NaN; this.muted.set(target, Number.isFinite(until) ? until : Infinity); const old = this.muteTimers.get(target); if (old !== undefined) this.o.clock.clearTimeout(old as never); if (Number.isFinite(until)) this.muteTimers.set(target, this.o.clock.setTimeout(() => { this.muted.delete(target); this.muteTimers.delete(target); }, Math.max(0, until - this.o.clock.now()))); break; }
      case 'control.unmute': this.muted.delete(target); { const t = this.muteTimers.get(target); if (t !== undefined) this.o.clock.clearTimeout(t as never); this.muteTimers.delete(target); } break;
      case 'control.role': this.server.setRole(target, p.role as 'editor' | 'viewer'); this.roster.setRole(target, p.role as 'editor' | 'viewer'); this.broadcastRoster(); break;
      case 'control.transfer_host': { const to = String(p.to); this.server.setRole(from, 'editor'); this.roster.setRole(from, 'editor'); this.server.setRole(to, 'host'); this.roster.setRole(to, 'host'); this.server.broadcast({ t: 'control', k: 'control.host_changed', p: { host: to, code: 'transfer' } } as never); this.broadcastRoster(); break; }
      case 'control.policy': { const { ...rest } = p; this.policy_ = { ...this.policy_, ...rest } as SessionPolicy; break; }
      case 'control.rotate_request': this.epoch++; this.server.broadcast({ t: 'control', k: 'control.rotate_key', p: { kid: `k${this.epoch}`, reason: String(p.reason) } } as never); break;
      case 'control.end': void this.stop(p.code as 'done' | 'abandoned' | 'error'); break;
      default: break;
    }
  }

  /* ------------------------------------------------------------- members */
  private onConnected(m: ConnectedMember, first: boolean): void {
    const isNew = this.roster.connected(m); if (m.role === 'host' || m.memberId === this.roster.hostId()) this.qm.setHostAway(false) && this.broadcastQueue();
    if (isNew || first) { this.emit('member-joined', { id: m.memberId }); this.broadcastRoster(); this.broadcastQueue(); } else { this.broadcastRoster(); }
  }
  private onDisconnected(m: ConnectedMember): void { this.roster.disconnected(m.memberId); if (m.memberId === this.roster.hostId() && this.qm.setHostAway(true)) this.broadcastQueue(); }

  /* ------------------------------------------------------------- snapshots */
  private armSnapshotTimer(): void { this.snapTimer = this.o.clock.setTimeout(() => { if (this.framesSinceSnapshot > 0) void this.snapshot().catch(() => undefined); if (!this.ended) this.armSnapshotTimer(); }, SNAPSHOT_MS); }
  async snapshot(): Promise<void> { if (!this.o.snapshotBuilder || this.snapshotting) return; this.snapshotting = true; try { const seq = this.server.headSeq(); const bytes = await this.o.snapshotBuilder(); await this.o.persistence.saveSnapshot(this.sid, { seq, bytes }); this.framesSinceSnapshot = 0; } finally { this.snapshotting = false; } }

  /* ------------------------------------------------------------- the host's own actions: the same path as remote frames */
  /** The host's own member, online through memory the first time it is needed. */
  hostLink(): { send(f: Omit<Frame, 'v'>): Promise<void> } { const l = this.server.createLoopbackLink(); if ((l as unknown as { state?: string }).state !== 'ready') l.connect(null); return l; }
  private act(frame: Omit<Frame, 'v'>): Promise<void> { return this.hostLink().send(frame as never); }
  approveItem(item: string) { return this.act({ t: 'queue', k: 'queue.approve', id: this.id(), sid: this.sid, p: { item } } as never); } rejectItem(item: string, code: string) { return this.act({ t: 'queue', k: 'queue.reject', id: this.id(), sid: this.sid, p: { item, code } } as never); } reorder(order: string[]) { return this.act({ t: 'queue', k: 'queue.reorder', id: this.id(), sid: this.sid, p: { order } } as never); }
  dropItem(item: string) { return this.act({ t: 'queue', k: 'queue.drop', id: this.id(), sid: this.sid, p: { item } } as never); } claim(item: string, agentId: string) { return this.act({ t: 'queue', k: 'queue.claim', id: this.id(), sid: this.sid, p: { item, agent_id: agentId } } as never); } complete(item: string, outcome: 'ok' | 'error' | 'canceled') { return this.act({ t: 'queue', k: 'queue.done', id: this.id(), sid: this.sid, p: { item, outcome } } as never); }
  kick(member: string, code: 'abuse' | 'inactive' | 'request' | 'other') { return this.act({ t: 'control', k: 'control.kick', id: this.id(), sid: this.sid, p: { member, code } } as never); } mute(member: string, until?: Date) { return this.act({ t: 'control', k: 'control.mute', id: this.id(), sid: this.sid, p: { member, ...(until ? { until: until.toISOString() } : {}) } } as never); } setRole(member: string, role: 'editor' | 'viewer') { return this.act({ t: 'control', k: 'control.role', id: this.id(), sid: this.sid, p: { member, role } } as never); }
  transferHost(to: string) { return this.act({ t: 'control', k: 'control.transfer_host', id: this.id(), sid: this.sid, p: { to } } as never); } setPolicy(p: SessionPolicy) { return this.act({ t: 'control', k: 'control.policy', id: this.id(), sid: this.sid, p } as never); } end(code: 'done' | 'abandoned' | 'error') { return this.act({ t: 'control', k: 'control.end', id: this.id(), sid: this.sid, p: { code } } as never); }
  private n = 0; private id(): string { return `msg_${Date.now().toString(36).toUpperCase().padStart(10, '0')}${String(++this.n).padStart(16, '0')}`.replace(/[ILOU]/g, 'A').slice(0, 30); }
}
