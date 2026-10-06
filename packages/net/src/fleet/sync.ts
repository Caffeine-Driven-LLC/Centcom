/** Keeps a branch-mode fleet in step: publishes our agents and locks as session events, and keeps a live view of everyone's. */
import { newIdGenerator } from '@centcom/protocol';
import { CentcomError } from '../errors/index.js';
import type { KeyRing } from '../crypto/keyring.js';
import { TypedEmitter } from '../relay/emitter.js';
import type { SessionHandle } from '../session/client.js';
import type { DecodedEvent } from '../session/types.js';
import { SpawnRejectedError } from './errors.js';
import { hmacFor, type LockBackend, type LockTransport } from './locks.js';
import { FleetModel, type FleetView, type Note } from './model.js';
import { STATE_GAP_MS, checkWireState } from './publisher.js';

export interface FleetClock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: never): void }
export interface FleetEvents { changed: [FleetView]; conflict: [{ agentIds: string[]; pathHmacs: string[]; paths?: string[] }]; 'lock-denied': [{ pathHmac: string; agentId: string; path?: string }]; 'lock-expired': [{ pathHmac: string; agentId: string; path?: string }] }
export interface FleetOptions { locks?: LockBackend; /** the key ring to hash paths with; by default the session's own */ ring?: () => KeyRing; clock: FleetClock; ids?: { next(prefix: 'msg'): string }; warn?: (msg: string, ctx?: Record<string, unknown>) => void }
const KINDS = new Set(['agent.spawn', 'agent.state', 'agent.exit', 'branch.update', 'file.lock', 'conflict.detected']);
const REFUSED = new Set(['quota_exceeded', 'entitlement_required', 'payment_required', 'subscription_inactive']);

export class FleetSync extends TypedEmitter<FleetEvents> {
  private readonly model: FleetModel; private readonly mine = new Set<string>(); private readonly ownLocks = new Map<string, { path: string; agentId: string; ttlMs?: number }>(); private readonly pendingLocks = new Map<string, { frameId: string; done: (r: 'granted' | 'denied') => void }>();
  private readonly lastState = new Map<string, string>(); private readonly stateOut = new Map<string, { sentAt: number; pending?: string; timer?: unknown }>(); private readonly ids: { next(prefix: 'msg'): string }; private offs: (() => void)[] = []; private started = false; private wasDown = false;
  constructor(private readonly session: SessionHandle, private readonly o: FleetOptions) {
    super(); this.model = new FleetModel((id) => this.session.roster().some((m) => m.id === id)); this.ids = o.ids ?? newIdGenerator({ now: () => o.clock.now(), random: (n) => crypto.getRandomValues(new Uint8Array(n)) });
  }
  start(): void {
    if (this.started) return; this.started = true; this.offs.push(this.session.onAny((e) => this.onEvent(e), { replay: true }), this.session.on('state', (s) => this.onState(s)));
  }
  stop(): void { this.started = false; for (const f of this.offs.splice(0)) f(); for (const s of this.stateOut.values()) if (s.timer !== undefined) this.o.clock.clearTimeout(s.timer as never); this.stateOut.clear(); for (const p of this.pendingLocks.values()) p.done('denied'); this.pendingLocks.clear(); }
  fleet(): FleetView { return this.model.view(); }
  private hmacOf(path: string): string { return this.o.ring ? hmacFor(this.o.ring(), path).hmac : this.session.pathMac(path); }

  /* ------------------------------------------------------------- publishing */
  async spawn(a: { agentId: string; mode: 'command_post' | 'branch'; label?: string; branch?: string; worktree?: string; model?: string; runsOn?: string; provider?: 'anthropic' | 'openai' | 'other' }): Promise<void> {
    try { await this.session.sendEvent('agent.spawn', { p: { agent_id: a.agentId, owner: this.session.me.id, mode: a.mode, ...(a.runsOn ? { runs_on: a.runsOn } : {}), ...(a.provider ? { provider: a.provider } : {}) }, secret: { ...(a.label !== undefined ? { label: a.label } : {}), ...(a.branch !== undefined ? { branch: a.branch } : {}), ...(a.worktree !== undefined ? { worktree: a.worktree } : {}), ...(a.model !== undefined ? { model: a.model } : {}) } }); this.mine.add(a.agentId); }
    catch (e) { if (e instanceof CentcomError && REFUSED.has(e.code)) throw new SpawnRejectedError(); throw e; }
  }
  /** Only names the contract knows go out; the same state twice sends nothing; at most 2 frames per agent per second, the latest one wins. */
  setState(agentId: string, state: string): void {
    checkWireState(state); if (this.lastState.get(agentId) === state) return; this.lastState.set(agentId, state); const out = this.stateOut.get(agentId) ?? { sentAt: -Infinity }; this.stateOut.set(agentId, out); const wait = out.sentAt + STATE_GAP_MS - this.o.clock.now();
    if (wait <= 0 && out.timer === undefined) { this.sendState(agentId, state, out); return; }
    out.pending = state; if (out.timer === undefined) out.timer = this.o.clock.setTimeout(() => { out.timer = undefined; const s = out.pending; out.pending = undefined; if (s !== undefined) this.sendState(agentId, s, out); }, Math.max(0, wait));
  }
  private sendState(agentId: string, state: string, out: { sentAt: number }): void { out.sentAt = this.o.clock.now(); void this.session.sendEvent('agent.state', { p: { agent_id: agentId, state, since: new Date(out.sentAt).toISOString() } }).catch(() => this.o.warn?.('fleet.state_not_sent')); }
  async exit(agentId: string, outcome: 'ok' | 'error' | 'canceled', errorCode?: string, detail?: string): Promise<void> {
    const out = this.stateOut.get(agentId); if (out?.timer !== undefined) { this.o.clock.clearTimeout(out.timer as never); out.timer = undefined; out.pending = undefined; }
    await this.session.sendEvent('agent.exit', { p: { agent_id: agentId, outcome, ...(errorCode ? { error_code: errorCode.slice(0, 200) } : {}) }, secret: detail ? { detail } : {} }); this.mine.delete(agentId); this.lastState.delete(agentId);
    for (const [h, l] of this.ownLocks) if (l.agentId === agentId) { this.ownLocks.delete(h); void this.releaseFrame(h, l.agentId, l.path); }
  }
  updateBranch(b: { agentId: string; branch: string; head: string; ahead: number; behind: number; dirty: boolean }): Promise<unknown> { return this.session.sendEvent('branch.update', { secret: { agent_id: b.agentId, branch: b.branch, head: b.head, ahead: b.ahead, behind: b.behind, dirty: b.dirty } }); }
  reportConflict(agentIds: string[], paths: string[]): Promise<unknown> { return this.session.sendEvent('conflict.detected', { p: { agent_ids: agentIds, path_hmacs: paths.map((p) => this.hmacOf(p)) }, secret: { paths } }); }

  /* ------------------------------------------------------------- locks */
  /** `granted` when the relay sequenced our acquire, `denied` when it answered with a denial (nobody retries on their own). */
  acquire(agentId: string, path: string, ttlMs?: number): Promise<'granted' | 'denied'> {
    const hmac = this.hmacOf(path); const frameId = this.ids.next('msg'); const key = `${hmac}:${agentId}`; this.pendingLocks.get(key)?.done('denied');
    return new Promise((resolve) => {
      let settled = false; const done = (r: 'granted' | 'denied'): void => { if (settled) return; settled = true; this.pendingLocks.delete(key); if (r === 'granted') this.ownLocks.set(hmac, { path, agentId, ...(ttlMs ? { ttlMs } : {}) }); else this.session.abandon(frameId, new Error('lock denied')); resolve(r); };
      this.pendingLocks.set(key, { frameId, done });
      this.session.sendEvent('file.lock', { id: frameId, p: { action: 'acquire', path_hmac: hmac, agent_id: agentId, ...(ttlMs ? { ttl_ms: ttlMs } : {}) }, secret: { path } }).then(() => done('granted'), () => done('denied'));
    });
  }
  async release(agentId: string, path: string): Promise<void> { const hmac = this.hmacOf(path); this.ownLocks.delete(hmac); await this.releaseFrame(hmac, agentId, path); }
  private releaseFrame(hmac: string, agentId: string, path: string): Promise<unknown> { return this.session.sendEvent('file.lock', { p: { action: 'release', path_hmac: hmac, agent_id: agentId }, secret: { path } }).catch(() => undefined); }
  /** The hook the local lock client publishes through, so local and shared locks use one path. */
  lockTransport(): LockTransport { return { ready: () => this.session.state === 'live', publish: ({ clear, secret }) => { if (clear.action === 'acquire') void this.acquire(clear.agent_id, secret.path, clear.ttl_ms); else void this.release(clear.agent_id, secret.path); } }; }
  /** After a reconnect our locks are unconfirmed: ask for them again; a denial means someone else took the path meanwhile, so we let go locally. */
  private onState(s: string): void {
    if (s === 'reconnecting') { this.wasDown = true; return; } if (s !== 'live' || !this.wasDown) return; this.wasDown = false;
    for (const [h, l] of [...this.ownLocks]) void this.acquire(l.agentId, l.path, l.ttlMs).then((r) => { if (r === 'denied') { this.ownLocks.delete(h); void Promise.resolve(this.o.locks?.release(l.path, l.agentId)); this.emit('lock-denied', { pathHmac: h, agentId: l.agentId, path: l.path }); } });
  }

  /* ------------------------------------------------------------- hearing */
  private onEvent(e: DecodedEvent): void {
    if (!KINDS.has(e.kind)) return; const notes = this.model.apply({ kind: e.kind, seq: e.seq, from: e.from, ts: e.ts, p: e.p, secret: e.secret }); let changed = false;
    for (const n of notes) changed = this.note(n, e) || changed; if (e.kind !== 'file.lock' || notes.length === 0) changed = true; if (changed) this.emit('changed', this.model.view());
    if (e.kind === 'file.lock' && e.p?.action && this.o.locks?.onRemoteLock) { try { this.o.locks.onRemoteLock({ action: String(e.p.action), path_hmac: String(e.p.path_hmac), agent_id: String(e.p.agent_id), ...(typeof e.p.ttl_ms === 'number' ? { ttl_ms: e.p.ttl_ms } : {}) }); } catch { this.o.warn?.('fleet.lock_backend_failed'); } }
  }
  private note(n: Note, e: DecodedEvent): boolean {
    switch (n.type) {
      case 'conflict': if (n.conflict.agentIds.some((id) => this.mine.has(id))) this.emit('conflict', { agentIds: n.conflict.agentIds, pathHmacs: n.conflict.pathHmacs, ...(n.conflict.paths ? { paths: n.conflict.paths } : {}) }); return true;
      case 'lock-denied': { const own = [...this.ownLocks.values()]; void own; const key = `${n.pathHmac}:${n.agentId}`; const pend = this.pendingLocks.get(key); const path = this.ownLocks.get(n.pathHmac)?.path; if (pend) pend.done('denied'); if (pend || this.mine.has(n.agentId)) this.emit('lock-denied', { pathHmac: n.pathHmac, agentId: n.agentId, ...(path ? { path } : {}) }); return false; }
      case 'lock-expired': { const own = this.ownLocks.get(n.lock.pathHmac); if (own && own.agentId === n.lock.agentId) { this.ownLocks.delete(n.lock.pathHmac); void Promise.resolve(this.o.locks?.release(own.path, own.agentId)); } this.emit('lock-expired', { pathHmac: n.lock.pathHmac, agentId: n.lock.agentId, ...(own ? { path: own.path } : {}) }); return true; }
      case 'agent': return true;
      case 'ignored': this.o.warn?.('fleet.event_ignored', { kind: e.kind }); return false;
    }
  }
}
