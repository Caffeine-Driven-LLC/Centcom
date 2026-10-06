/** ReliableChannel: ordered, at-least-once, de-duplicated delivery of sequenced frames over any FrameLink (relay or LAN).
 *  Owns seq tracking, the hold buffer, acks, the unacked outbox, resends and resume results (CT-WS-ENVELOPE, CT-RESUME).
 *  Must not: touch sockets or backoff (lane C054), decrypt or read frame bodies (C056 and feature lanes), fetch snapshots or
 *  history (C057), assign seq (C072); resend before a welcome; deliver past a gap; log anything but seq numbers, counts and ids. */
import { ProtocolError, parseFrame, type Frame } from '@centcom/protocol';
import { CentcomError } from '../errors/index.js';
import type { Logger } from '../log/index.js';
import { FrameTooLargeError, RelayError, TypedEmitter, type FrameLink, type RelayClock, type Welcome } from '../relay/index.js';
import { AckScheduler } from './ack-scheduler.js';
import { Inbox, isSequencedType, type SequencedFrame } from './inbox.js';
import { Outbox, type OutboxEntry } from './outbox.js';
import { ResumeTracker } from './resume.js';
import type { SeqStore } from './seq-store.js';
import { createMsgIdGenerator, type IdGenerator } from './ulid.js';

/** A gap that has not healed after this long gets a sys.resume, and after twice this long a reconnect. */
export const HOLD_MS = 5_000;

export type Ciphertext = NonNullable<Frame['ct']>;
export interface SendDraft { t: 'event' | 'queue' | 'control'; k: string; p?: Record<string, unknown>; ct?: Ciphertext; sig?: string; ref?: string; id?: string }
export interface EphemeralDraft { t: 'presence'; k: string; p?: Record<string, unknown>; ct?: Ciphertext; sig?: string }
export interface ChannelEvents {
  /** in seq order, exactly once per seq */
  frame: [SequencedFrame];
  'snapshot-required': [{ snapshotSeq: number }];
  resumed: [{ fromSeq: number; toSeq: number; count: number; historyGap?: boolean }];
  /** a frame was resent 3 times without an echo; it stays queued for the next reconnect */
  stuck: [{ id: string }];
  /** seqs: lowest missing and lowest held (or, after a bad sys.resumed, the expected and received counts) */
  gap: [{ expected: number; got: number }];
}
export interface ReliableChannelOptions {
  link: FrameLink; sessionId: string;
  /** our member id, to match echoes (default: welcome.member.id) */
  memberId?: () => string | null;
  seqStore?: SeqStore; clock?: RelayClock; ids?: IdGenerator; logger?: Logger;
  /** default 1000 */
  maxUnacked?: number;
  /** default 8 MiB */
  maxUnackedBytes?: number;
  /** default 5000 */
  holdMs?: number;
}

const realClock: RelayClock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) };
const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
/** Errors after which a frame can never go out: give up on it rather than resend forever. */
const permanent = (e: unknown): boolean => e instanceof FrameTooLargeError || e instanceof ProtocolError || (e instanceof RelayError && e.localCode === 'capability_not_negotiated');

export class ReliableChannel extends TypedEmitter<ChannelEvents> {
  private readonly link: FrameLink; private readonly sid: string; private readonly clock: RelayClock; private readonly ids: IdGenerator; private readonly log?: Logger;
  private readonly inbox = new Inbox(); private readonly outbox: Outbox; private readonly acks: AckScheduler; private readonly tracker = new ResumeTracker();
  private readonly holdMs: number;
  private connected = false; private conn = 0;
  private gapTimer: unknown; private sweepTimer: unknown; private sweepAt = Infinity;
  private drainWaiters: { resolve: () => void; timer: unknown }[] = [];
  private readonly unsub: (() => void)[] = [];

  constructor(private readonly o: ReliableChannelOptions) {
    super(() => this.log?.warn('delivery.listener_failed'));
    this.link = o.link; this.sid = o.sessionId; this.clock = o.clock ?? realClock; this.holdMs = o.holdMs ?? HOLD_MS;
    this.ids = o.ids ?? createMsgIdGenerator({ now: () => this.clock.now() }); this.log = o.logger?.child({ component: 'delivery', session_id: o.sessionId });
    this.outbox = new Outbox({ maxCount: o.maxUnacked, maxBytes: o.maxUnackedBytes });
    this.acks = new AckScheduler({ clock: this.clock, lastSeq: () => this.inbox.lastSeq, send: (seq) => this.sendAck(seq) });
    this.unsub.push(this.link.on('welcome', (w) => this.onWelcome(w)), this.link.on('frame', (f) => this.onFrame(f)), this.link.on('closed', () => this.onDisconnected()));
  }

  /** Load lastSeq from the SeqStore. Await it before the link connects so hello carries it. A failing store means a fresh resume (null). */
  async init(): Promise<void> {
    if (!this.o.seqStore) return;
    try { const v = await this.o.seqStore.load(this.sid); if (this.inbox.lastSeq === null && int(v) && v >= 0) this.inbox.setLastSeq(v); } catch { this.log?.warn('delivery.seq_load_failed'); }
  }

  /** The relay refused a frame (a sys.error says so without naming it): the oldest frame still waiting for its echo is the one, because the relay answers in order. Returns whether there was one. */
  refuseOldest(err: unknown): boolean { const e = this.outbox.list()[0]; if (!e) return false; this.outbox.fail(e.id, err); this.checkDrain(); return true; }
  /** Send an ack for everything processed now (and so save the position): used before leaving. */
  async flush(): Promise<void> { if (this.connected) await this.acks.flush(); }
  /** Highest contiguous seq processed (for hello's last_seq), or null. */
  lastSeq(): number | null { return this.inbox.lastSeq; }
  /** Sequenced frames sent and not echoed yet. */
  pending(): number { return this.outbox.size; }

  /** Send a sequenced frame. Resolves with the seq from the server's echo; rejects OutboxFullError at the caps. */
  send(draft: SendDraft): Promise<{ id: string; seq: number }> {
    if (draft.t !== 'event' && draft.t !== 'queue' && draft.t !== 'control') return Promise.reject(new TypeError('send() takes event, queue or control frames'));
    const id = draft.id ?? this.ids.next('msg');
    const frame = { v: 1 as const, t: draft.t, id, sid: this.sid, k: draft.k, ...(draft.p !== undefined ? { p: draft.p } : {}), ...(draft.ct ? { ct: draft.ct } : {}), ...(draft.sig !== undefined ? { sig: draft.sig } : {}), ...(draft.ref !== undefined ? { ref: draft.ref } : {}) };
    let r: ReturnType<Outbox['add']>; try { r = this.outbox.add(frame, Buffer.byteLength(JSON.stringify(frame))); } catch (e) { return Promise.reject(e); }
    if (r.fresh && this.connected) this.write(r.entry);
    return r.entry.promise;
  }

  /** Presence: written once if connected, never kept, never resent. */
  sendEphemeral(draft: EphemeralDraft): void {
    if (draft.t !== 'presence') throw new TypeError('sendEphemeral() takes presence frames');
    if (!this.connected) return;
    this.link.send({ v: 1, t: 'presence', sid: this.sid, k: draft.k, ...(draft.p !== undefined ? { p: draft.p } : {}), ...(draft.ct ? { ct: draft.ct } : {}), ...(draft.sig !== undefined ? { sig: draft.sig } : {}) }).catch(() => undefined);
  }

  /** After a snapshot (or to skip ahead): lastSeq becomes `seq`, held frames above it are delivered, then sys.resume {last_seq} asks for the rest (a reconnect when the server has no resume cap). */
  async resumeFrom(seq: number, o: { ask?: boolean } = {}): Promise<void> {
    if (!int(seq) || seq < 0) throw new TypeError('resumeFrom() needs a seq >= 0');
    this.clearGap(); this.deliver(this.inbox.setLastSeq(seq)); this.save(seq);
    this.log?.info('delivery.resume_from', { seq });
    if (o.ask !== false) await this.askResume(seq); /* `ask: false` sets the position only: REST history fills the gap before the relay is asked for the rest */
    if (this.inbox.held) this.armGap();
  }

  /** Feed REST history frames through the same order and dedupe path. Returns how many frames were delivered. */
  applyHistory(frames: readonly unknown[]): number {
    let n = 0;
    for (const raw of frames) {
      const r = parseFrame(raw); if (!r.ok) { this.log?.warn('delivery.history_frame_invalid'); continue; }
      const f = r.value; if (!isSequencedType(f.t) || !int(f.seq) || f.seq < 1) continue;
      n += this.onSequenced(f as SequencedFrame, false);
    }
    return n;
  }

  /** Resolves when every sent frame has its echo; rejects with a timeout error after `timeoutMs`. */
  drain(timeoutMs: number): Promise<void> {
    if (this.outbox.size === 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const w = { resolve, timer: undefined as unknown };
      w.timer = this.clock.setTimeout(() => { this.drainWaiters = this.drainWaiters.filter((x) => x !== w); reject(new CentcomError({ kind: 'timeout', detail: `${this.outbox.size} frames still unacked` })); }, timeoutMs);
      this.drainWaiters.push(w);
    });
  }

  /** Stop listening to the link and clear every timer. Unacked frames stay pending (their promises do not settle). */
  dispose(): void { for (const u of this.unsub.splice(0)) u(); this.connected = false; this.clearGap(); this.clearSweep(); this.acks.stop(); }

  /* ------------------------------------------------------------ link events */

  private onWelcome(w: Welcome): void {
    this.connected = true; this.conn++; this.tracker.cancel();
    const last = this.inbox.lastSeq; const r = w.resume;
    if (r && r.snapshot_required === true) { this.inbox.snapshotMode = true; this.clearGap(); }
    else if (last !== null) {
      this.tracker.begin(last);
      const from = r?.from_seq; if (int(from) && from > last + 1) { this.log?.warn('delivery.history_gap', { last_seq: last, from_seq: from }); this.deliver(this.inbox.setLastSeq(from - 1)); }
    }
    this.outbox.onWelcome(); const queued = this.outbox.list();
    if (queued.length) this.log?.info('delivery.resend', { count: queued.length });
    for (const e of queued) this.write(e);
    if (this.acks.unacked > 0) void this.acks.flush();
    if (this.inbox.held && !this.inbox.snapshotMode) this.armGap();
  }

  private onDisconnected(): void { this.connected = false; this.tracker.cancel(); this.clearGap(); this.clearSweep(); this.acks.stop(); }

  private onFrame(f: Frame): void {
    if (f.t === 'sys.resumed') return this.onResumed(f.p);
    if (!isSequencedType(f.t) || !int(f.seq) || f.seq < 1) return; /* presence, pings, notices: never sequenced */
    this.onSequenced(f as SequencedFrame, true);
  }

  /** Returns how many frames were delivered. */
  private onSequenced(f: SequencedFrame, live: boolean): number {
    this.tracker.note(f.seq);
    if (f.id && this.outbox.has(f.id) && this.isMine(f)) {
      const e = this.outbox.get(f.id)!; const last = this.inbox.lastSeq;
      /* a frame first written on this connection must get a seq above everything already processed; if not, the relay's seq space was reset */
      if (live && e.firstConn === this.conn && last !== null && f.seq <= last) { this.relayReset(f.seq); return 0; }
      this.outbox.echo(f.id, f.seq); this.checkDrain();
    }
    const r = this.inbox.accept(f);
    if (r.status === 'overflow') { this.log?.warn('delivery.hold_overflow', { held: this.inbox.held, last_seq: this.inbox.lastSeq }); this.inbox.clearHold(); this.forceReconnect('hold_overflow'); return 0; }
    if (r.status === 'held' && !this.inbox.snapshotMode) this.armGap();
    this.deliver(r.delivered);
    if (this.inbox.held === 0) this.clearGap();
    return r.delivered.length;
  }

  private onResumed(body: unknown): void {
    const out = this.tracker.finish(body, this.inbox.lastSeq);
    switch (out.kind) {
      case 'snapshot': this.inbox.snapshotMode = true; this.clearGap(); this.log?.info('delivery.snapshot_required', { snapshot_seq: out.snapshotSeq }); this.emit('snapshot-required', { snapshotSeq: out.snapshotSeq }); return;
      case 'ok': {
        const last = this.inbox.lastSeq;
        if (out.historyGap && last !== null && last < out.fromSeq - 1) this.deliver(this.inbox.setLastSeq(out.fromSeq - 1));
        this.log?.info('delivery.resumed', { from_seq: out.fromSeq, to_seq: out.toSeq, count: out.count });
        this.emit('resumed', { fromSeq: out.fromSeq, toSeq: out.toSeq, count: out.count, ...(out.historyGap ? { historyGap: true } : {}) }); return;
      }
      case 'mismatch': this.log?.warn('delivery.resume_mismatch', { expected: out.expected, got: out.got }); this.emit('gap', { expected: out.expected, got: out.got }); this.forceReconnect('resume_mismatch'); return;
      case 'reset': this.relayReset(out.toSeq); return;
      case 'invalid': this.log?.warn('delivery.resumed_invalid'); return;
    }
  }

  /* ------------------------------------------------------------ outbound */

  private write(e: OutboxEntry): void {
    const last = this.inbox.lastSeq; const f = last === null ? e.frame : { ...e.frame, ack: last };
    this.outbox.markSent(e.id, this.conn, this.clock.now());
    this.link.send(f).then(() => { if (last !== null) { this.acks.onPiggyback(last); this.save(last); } }, (err: unknown) => {
      if (!permanent(err)) return; /* not connected or buffer full: the next welcome or the 30 s sweep sends it again */
      this.log?.warn('delivery.frame_refused', { id: e.id, error: (err as Error)?.name }); this.outbox.fail(e.id, err); this.checkDrain();
    });
    this.scheduleSweep();
  }

  private async sendAck(seq: number): Promise<boolean> {
    if (!this.connected) return false;
    try { await this.link.send({ v: 1, t: 'ack', sid: this.sid, ack: seq }); this.save(seq); return true; } catch { return false; }
  }

  private scheduleSweep(): void {
    if (!this.connected) return; const at = this.outbox.nextDueAt();
    if (at === Infinity) { this.clearSweep(); return; }
    if (this.sweepTimer !== undefined && this.sweepAt <= at) return;
    this.clearSweep(); this.sweepAt = at; this.sweepTimer = this.clock.setTimeout(() => { this.sweepTimer = undefined; this.sweepAt = Infinity; this.sweep(); }, Math.max(0, at - this.clock.now()));
  }
  /** Resend frames unechoed for 30 s (up to 3 times), then report them stuck. */
  private sweep(): void {
    if (!this.connected) return; const { resend, stuck } = this.outbox.due(this.clock.now());
    for (const e of resend) { this.log?.info('delivery.resend_unechoed', { id: e.id, resends: e.resends }); this.write(e); }
    for (const e of stuck) { this.log?.warn('delivery.stuck', { id: e.id }); this.emit('stuck', { id: e.id }); }
    this.scheduleSweep();
  }
  private clearSweep(): void { if (this.sweepTimer !== undefined) this.clock.clearTimeout(this.sweepTimer as never); this.sweepTimer = undefined; this.sweepAt = Infinity; }

  /* ------------------------------------------------------------ gaps */

  private armGap(): void {
    if (this.gapTimer !== undefined) return;
    this.gapTimer = this.clock.setTimeout(() => {
      this.gapTimer = undefined; const g = this.inbox.gap(); if (!g) return;
      this.log?.warn('delivery.gap', { expected: g.expected, got: g.got, held: this.inbox.held }); this.emit('gap', g);
      void this.askResume(g.expected - 1);
      this.gapTimer = this.clock.setTimeout(() => { this.gapTimer = undefined; if (this.inbox.gap()) this.forceReconnect('gap'); }, this.holdMs);
    }, this.holdMs);
  }
  private clearGap(): void { if (this.gapTimer !== undefined) this.clock.clearTimeout(this.gapTimer as never); this.gapTimer = undefined; }

  /** sys.resume {last_seq}; a link without the resume cap (or not connected) refuses it, and a reconnect does the same job through hello. */
  private async askResume(last: number): Promise<void> {
    this.tracker.begin(last);
    try { await this.link.send({ v: 1, t: 'sys.resume', sid: this.sid, p: { last_seq: last } }); } catch { this.tracker.cancel(); this.forceReconnect('resume_refused'); }
  }

  /** The relay's seq went backwards: forget our position and rejoin fresh (snapshot and history fill in). */
  private relayReset(got: number): void {
    const expected = (this.inbox.lastSeq ?? 0) + 1; this.log?.warn('delivery.relay_reset', { expected, got });
    this.emit('gap', { expected, got }); this.inbox.reset(); this.acks.reset(); this.tracker.cancel(); this.clearGap();
    this.forceReconnect('relay_reset');
  }
  private forceReconnect(why: string): void {
    this.clearGap(); this.log?.warn('delivery.reconnect', { why });
    if (this.link.reconnect) this.link.reconnect(); else this.log?.warn('delivery.reconnect_unsupported');
  }

  /* ------------------------------------------------------------ helpers */

  private deliver(frames: SequencedFrame[]): void { for (const f of frames) { this.emit('frame', f); this.acks.onDelivered(); } }
  private isMine(f: Frame): boolean { const me = this.o.memberId?.() ?? this.link.welcome?.member.id ?? null; return !me || !f.from || f.from === me; }
  private save(seq: number): void { this.o.seqStore?.save(this.sid, seq).catch(() => this.log?.warn('delivery.seq_save_failed')); }
  private checkDrain(): void { if (this.outbox.size > 0) return; for (const w of this.drainWaiters.splice(0)) { this.clock.clearTimeout(w.timer as never); w.resolve(); } }
}
