/** The queue client: submit, track and cancel; the host approves, rejects, reorders, drops, claims and completes. Everything shown comes from the sequenced `queue.*` frames of the session. */
import { newIdGenerator } from '@centcom/protocol';
import { CentcomError } from '../errors/index.js';
import { TypedEmitter } from '../relay/emitter.js';
import { SessionError, type DecodedEvent } from '../session/types.js';
import type { SessionHandle } from '../session/client.js';
import { MAX_CT_BYTES } from '../crypto/frame.js';
import { ItemGoneError, NotAllowedError, NotHostError, QueueFullError, QueueItemTooLargeError, UnknownItemError } from './errors.js';
import { hostControls, type DoneOutcome, type RejectCode } from './host-controls.js';
import { QueueModel, type QEvent, type QueueItem, type QueueView } from './model.js';
import { checkSubmit } from './prechecks.js';

export interface Attachment { name?: string; mime?: string; size?: number; [k: string]: unknown }
export interface QueueEvents { changed: [QueueView]; rejected: [{ item: string; code?: string }]; error: [Error]; ignored: [{ kind: string; reason: string; from: string }] }
export interface QueueClientOptions { /** switch the local checks off (tests use it to see the server's own answer) */ prechecks?: boolean; now?: () => Date; random?: (n: number) => Uint8Array; warn?: (msg: string, ctx?: Record<string, unknown>) => void }
const ID_RE = /^que_[0-9A-HJKMNP-TV-Z]{26}$/;
/** Frame ids are `msg_` ids (the envelope requires it) and carry the item's ULID, so one item is one frame to the relay and a retry is a no-op there. */
export const frameIdOf = (item: string): string => `msg_${item.slice(4)}`;

/** Server refusals mapped to errors people can act on. */
export function mapError(e: unknown): unknown {
  if (e instanceof SessionError && e.code === 'too_large') return new QueueItemTooLargeError();
  if (e instanceof CentcomError) {
    if (e.code === 'queue_full') return new QueueFullError(); if (e.code === 'queue_item_gone') return new ItemGoneError();
    if (['forbidden', 'role_insufficient', 'muted', 'session_locked', 'queue_not_allowed', 'host_required'].includes(e.code)) return new NotAllowedError('forbidden');
  }
  return e;
}

export class QueueClient extends TypedEmitter<QueueEvents> {
  private readonly model = new QueueModel(); private readonly muted = new Set<string>(); private readonly ids: ReturnType<typeof newIdGenerator>; private readonly ctl: ReturnType<typeof hostControls>; private readonly offs: (() => void)[] = [];
  constructor(private readonly session: SessionHandle, private readonly opts: QueueClientOptions = {}) {
    super();
    const now = opts.now ?? (() => new Date()); this.ids = newIdGenerator({ now: () => now().getTime(), random: opts.random ?? ((n) => crypto.getRandomValues(new Uint8Array(n))) }); this.ctl = hostControls(session);
    this.offs.push(session.onAny((e) => this.onEvent(e), { replay: true }), session.on('state', (s) => { this.model.setPaused(s === 'paused'); this.emit('changed', this.model.view()); }), session.on('error', (e) => this.emit('error', Object.assign(new Error(e.code), { code: e.code }))));
  }
  dispose(): void { for (const o of this.offs.splice(0)) o(); }
  snapshot(): QueueView { return this.model.view(); }

  private roleOf = (m: string) => (m === 'srv' ? 'host' : this.session.roster().find((x) => x.id === m)?.role);
  private onEvent(e: DecodedEvent): void {
    if (e.kind === 'control.mute' && typeof e.p?.member === 'string') { this.muted.add(e.p.member); return; } if (e.kind === 'control.unmute' && typeof e.p?.member === 'string') { this.muted.delete(e.p.member); return; }
    if (!e.kind.startsWith('queue.')) return;
    const q: QEvent = { kind: e.kind, seq: e.seq, from: e.from, ts: e.ts, p: e.p, secret: e.secret }; const before = this.model.version; const r = this.model.apply(q, { roleOf: this.roleOf });
    if (r.ignored) { if (r.ignored === 'not_host' || r.ignored === 'forged_state' || r.ignored === 'not_submitter' || r.ignored === 'viewer') this.opts.warn?.('queue.frame_ignored', { kind: e.kind, reason: r.ignored }); this.emit('ignored', { kind: e.kind, reason: r.ignored, from: e.from }); return; }
    if (e.kind === 'queue.reject' && typeof e.p?.item === 'string') this.emit('rejected', { item: e.p.item, ...(typeof e.p.code === 'string' ? { code: e.p.code } : {}) });
    if (this.model.version !== before) this.emit('changed', this.model.view());
  }

  async submit(o: { body: string; kind?: 'message' | 'command'; attachments?: Attachment[]; /** retry an earlier submit: the same item is the same frame */ item?: string }): Promise<{ item: string; seq: number }> {
    const me = this.session.me; if (o.item !== undefined && !ID_RE.test(o.item)) throw new TypeError('item must be a que_ id');
    if (new TextEncoder().encode(o.body).length > MAX_CT_BYTES) throw new QueueItemTooLargeError();
    if (this.opts.prechecks !== false) checkSubmit({ role: me.role, muted: this.muted.has(me.id), locked: this.session.policy.locked === true, paused: false, liveOfMember: this.model.liveCountOf(me.id), liveTotal: this.model.liveCount(), queueLimit: this.session.policy.queue_limit });
    const item = o.item ?? this.ids.next('que'); const kind = o.kind ?? 'message';
    try { const r = await this.session.sendEvent('queue.submit', { id: frameIdOf(item), p: { item, size: '$ctBytes', kind }, secret: { body: o.body, ...(o.attachments?.length ? { attachments: o.attachments } : {}) } }); return { item, seq: r.seq }; } catch (e) { throw mapError(e); }
  }
  async cancel(item: string): Promise<void> {
    const it = this.model.get(item); if (this.opts.prechecks !== false) { if (!it) throw new UnknownItemError(); if (it.submitter !== this.session.me.id) throw new NotAllowedError('forbidden', 'Only the person who added an item can cancel it.'); if (it.state !== 'queued' && it.state !== 'approved' && it.state !== 'held') throw new ItemGoneError(); }
    try { await this.session.sendEvent('queue.cancel', { p: { item } }); } catch (e) { throw mapError(e); }
  }
  private host<T>(f: () => Promise<T>): Promise<T> { if (this.session.me.role !== 'host') return Promise.reject(new NotHostError()); return f().catch((e) => { throw mapError(e); }); }
  approve(item: string) { return this.host(() => this.ctl.approve(item)); }
  reject(item: string, code: RejectCode, note?: string) { return this.host(() => this.ctl.reject(item, code, note)); }
  reorder(order: string[]) { return this.host(() => this.ctl.reorder(order)); }
  drop(item: string) { return this.host(() => this.ctl.drop(item)); }
  claim(item: string, agentId: string) { return this.host(() => this.ctl.claim(item, agentId)); }
  done(item: string, outcome: DoneOutcome) { return this.host(() => this.ctl.done(item, outcome)); }
  get(item: string): QueueItem | undefined { return this.model.get(item); }
}
