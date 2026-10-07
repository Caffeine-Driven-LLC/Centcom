/** The host's authority actions, and what the control frames mean for us. */
import { assertWritableEventPayload } from '@centcom/protocol';
import { CentcomError } from '../errors/index.js';
import { TypedEmitter } from '../relay/emitter.js';
import type { SessionHandle } from '../session/client.js';
import type { DecodedEvent, SessionPolicy } from '../session/types.js';
import { ForbiddenError, InvalidPolicyError, NotHostError, SelfActionError } from './errors.js';
import { readServerFrame, type ServerEvent } from './receiver.js';
import { ControlStateModel, type ControlState } from './state.js';

export type KickCode = 'abuse' | 'inactive' | 'request' | 'other'; export type EndCode = 'done' | 'abandoned' | 'error';
export interface ControlEvents {
  'member-joined': [Extract<ServerEvent, { type: 'member-joined' }>]; 'member-left': [Extract<ServerEvent, { type: 'member-left' }>]; roster: [Extract<ServerEvent, { type: 'roster' }>]; 'host-changed': [Extract<ServerEvent, { type: 'host-changed' }>];
  'session-state': [Extract<ServerEvent, { type: 'session-state' }>]; 'rotate-key': [Extract<ServerEvent, { type: 'rotate-key' }>]; policy: [SessionPolicy]; 'removed-from-session': [{ code: string }];
  'became-host': []; 'lost-host': []; muted: [{ until?: string }]; unmuted: []; warning: [{ reason: string }];
}
export interface ControlClock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: never): void }
const real: ControlClock = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) };
const SEND_ERRORS = new Set(['forbidden', 'role_insufficient', 'host_required', 'not_a_member']);

export class ControlClient extends TypedEmitter<ControlEvents> {
  private readonly st: ControlStateModel; private readonly clock: ControlClock; private rosterVersion = 0; private muteTimer: unknown; private removedFired = false; private readonly offs: (() => void)[] = [];
  /** how many forged or stale control frames were refused */
  warnings = 0;
  constructor(private readonly session: SessionHandle, o: { clock?: ControlClock } = {}) {
    super(); this.clock = o.clock ?? real; const host = session.roster().find((m) => m.role === 'host')?.id ?? '';
    this.st = new ControlStateModel({ meId: session.me.id, role: session.me.role, host, policy: session.policy }, () => this.clock.now());
    const cur = session.muted(); if (cur.muted) { this.st.apply('control.mute', { member: session.me.id, ...(cur.until ? { until: cur.until } : {}) }, 0); this.armMute(); }
    this.offs.push(session.onAny((e) => this.onEvent(e)), session.on('removed', (r) => this.removed(r.code)), session.on('protocol-warning', (w) => { if (w.reason === 'forged_server_frame' || w.reason === 'stale_roster') { this.warnings++; this.emit('warning', { reason: w.reason }); } }));
  }
  dispose(): void { for (const f of this.offs.splice(0)) f(); if (this.muteTimer !== undefined) this.clock.clearTimeout(this.muteTimer as never); }
  state(): ControlState { const s = this.st.get(); return { ...s, me: { ...s.me, muted: s.me.muted } }; }

  /* ------------------------------------------------------------- what we hear */
  private onEvent(e: DecodedEvent): void {
    if (!e.kind.startsWith('control.')) return;
    const r = readServerFrame(e, { lastRosterVersion: this.rosterVersion }); if (r.warn) { this.warnings++; this.emit('warning', { reason: r.warn }); return; }
    this.st.setMeId(this.session.me.id); const changes = this.st.apply(e.kind, e.p ?? {}, e.seq);
    if (r.event) { if (r.event.type === 'roster') this.rosterVersion = r.event.version; this.emitServer(r.event); if (r.event.type === 'member-left' && r.event.member === this.session.me.id && (r.event.code === 'kicked' || r.event.code === 'revoked')) this.removed(r.event.code); }
    if (e.kind === 'control.policy') this.emit('policy', this.st.get().policy);
    for (const c of changes) { if (c.kind === 'became-host') this.emit('became-host'); else if (c.kind === 'lost-host') this.emit('lost-host'); else if (c.kind === 'muted') { this.emit('muted', { ...(this.st.get().me.mutedUntil ? { until: this.st.get().me.mutedUntil } : {}) }); this.armMute(); } else if (c.kind === 'unmuted') this.emit('unmuted'); }
  }
  private emitServer(ev: ServerEvent): void { (this.emit as (k: string, ...a: unknown[]) => void).call(this, ev.type, ev); }
  /** A mute with an end time ends by itself at that time. */
  private armMute(): void { if (this.muteTimer !== undefined) this.clock.clearTimeout(this.muteTimer as never); const at = this.st.nextMuteEnd(); if (at === undefined) return; this.muteTimer = this.clock.setTimeout(() => { this.muteTimer = undefined; if (this.st.expireMute()) this.emit('unmuted'); else this.armMute(); }, Math.max(0, at - this.clock.now()) + 1); }
  private removed(code: string): void { if (this.removedFired) return; this.removedFired = true; this.emit('removed-from-session', { code }); }

  /* ------------------------------------------------------------- what we do */
  private host<T>(f: () => Promise<T>): Promise<T> { if (this.session.me.role !== 'host') return Promise.reject(new NotHostError()); return f().catch((e) => { throw mapSendError(e); }); }
  private send(kind: string, p: Record<string, unknown>): Promise<{ seq: number }> { return this.session.sendEvent(kind, { p }).then((r) => ({ seq: r.seq })); }
  kick(member: string, code: KickCode) { return this.host(async () => { if (member === this.session.me.id) throw new SelfActionError('remove'); return this.send('control.kick', { member, code }); }); }
  mute(member: string, until?: Date) { return this.host(async () => { if (member === this.session.me.id) throw new SelfActionError('mute'); return this.send('control.mute', { member, ...(until ? { until: until.toISOString() } : {}) }); }); }
  unmute(member: string) { return this.host(() => this.send('control.unmute', { member })); }
  setRole(member: string, role: 'editor' | 'viewer') { return this.host(async () => { if (member === this.session.me.id) throw new SelfActionError('change the role of'); return this.send('control.role', { member, role }); }); }
  transferHost(to: string) { return this.host(async () => { if (to === this.session.me.id) throw new SelfActionError('hand the session to'); return this.send('control.transfer_host', { to }); }); }
  endSession(code: EndCode) { return this.host(() => this.send('control.end', { code })); }
  /** The whole policy (the relay keeps what you leave out as it was). Checked against the contract before anything is sent. */
  setPolicy(p: SessionPolicy & { auto_approve: 'ask' | 'trusted' | 'everyone'; share_history: boolean; queue_limit: number }) {
    return this.host(async () => { try { assertWritableEventPayload('control.policy', p); } catch (e) { throw new InvalidPolicyError(((e as { issues?: { pointer: string; code: string }[] }).issues ?? []).map((i) => `${i.pointer || '/'} ${i.code}`)); } return this.send('control.policy', p as unknown as Record<string, unknown>); });
  }
  /** Ask for a new epoch (host only). The relay answers with `control.rotate_key`, which the session client acts on. */
  requestRotation(reason: 'scheduled' | 'requested'): Promise<void> { if (this.session.me.role !== 'host') return Promise.reject(new ForbiddenError('Only the host can ask for a new key.')); return this.send('control.rotate_request', { reason }).then(() => undefined, (e) => { throw mapSendError(e); }); }
}
function mapSendError(e: unknown): unknown { if (e instanceof CentcomError && SEND_ERRORS.has(e.code)) return new ForbiddenError(); return e; }
