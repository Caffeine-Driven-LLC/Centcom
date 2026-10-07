/** GuestSession: a guest's live, ordered, decrypted copy of a command post, over any transport (lane C076). Crypto stays behind `FrameDecoder` (signature check and decrypt are the session client's job); this class never logs `ct`, bodies or paths. */
import { CentcomError } from '@centcom/net';
import type { Frame } from '@centcom/protocol';
import { transportCloseError } from '../transport/errors.js';
import type { SessionTransport } from '../transport/types.js';
import { GuestIngest } from './ingest.js';
import { KeyWaitBuffer } from './key-wait.js';
import { reduceGuestState } from './reduce.js';
import { WARNING_RING, initialGuestState, type DecodedFrame, type GuestState, type Role } from './state.js';

export type DecodeResult = { kind: 'ok'; frame: DecodedFrame } | { kind: 'wait_key' } | { kind: 'drop'; reason: string };
export interface FrameDecoder { decode(f: Frame): DecodeResult }
export interface GuestClock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: never): void }
export interface GuestOptions {
  transport: SessionTransport; decoder: FrameDecoder; clock: GuestClock; ids: { msg(): string; que(): string; };
  /** encrypts a queue body with the session key: the guest sends `ct` and `p.size` from it */
  sealBody(body: string): Promise<{ alg: string; kid: string; n: string; c: string }>;
  /** signs a hybrid frame over its canonical JSON (the device key lives behind this) */
  sign(frame: Omit<Frame, 'sig'>): Promise<string>;
  /** called once after a 4401 before the transport reconnects */ refreshTicket?(): Promise<void>; random?: () => number; sid: string;
}
const MEMBER_CAP = 5; const LIVE_STATES = new Set(['queued', 'approved', 'running', 'held']);
const err = (code: string, status: number): CentcomError => new CentcomError({ kind: 'api', code: code as never, status });

export class GuestSession {
  private st: GuestState; private readonly fns = new Set<(s: GuestState) => void>(); private readonly ingest = new GuestIngest<Frame>(); private readonly wait = new KeyWaitBuffer(); private readonly pending = new Map<string, { frame: Frame; resolve: () => void; reject: (e: unknown) => void }>(); private refreshed = false; private off: (() => void)[] = []; private left = false;
  private constructor(private readonly o: GuestOptions) { this.st = initialGuestState({ member: '' }); }

  static async join(o: GuestOptions): Promise<GuestSession> {
    const g = new GuestSession(o); g.off.push(o.transport.on('frame', (f) => g.onFrame(f)), o.transport.on('closed', (c) => g.onClosed(c)), o.transport.on('welcome', (w) => g.onWelcome(w as never))); await o.transport.connect(); return g;
  }
  get state(): GuestState { return this.st; }
  readonly state$ = { subscribe: (fn: (s: GuestState) => void): (() => void) => { this.fns.add(fn); fn(this.st); return () => { this.fns.delete(fn); }; } };
  private set(next: GuestState): void { if (next === this.st) return; this.st = next; for (const f of [...this.fns]) { try { f(next); } catch { /* a listener must not break the engine */ } } }

  private onWelcome(w: { member: { id: string; slot: number; role: string }; resume: Record<string, unknown> | null }): void {
    const role = (w.member.role === 'host' || w.member.role === 'editor' ? w.member.role : 'viewer') as Role; const fresh = this.st.me.member === '' || w.resume === null;
    this.set(fresh ? { ...initialGuestState({ member: w.member.id, slot: w.member.slot, role }), warnings: this.st.warnings } : { ...this.st, me: { ...this.st.me, member: w.member.id }, phase: this.st.roster.length ? 'live' : 'connecting' });
    this.refreshed = false; for (const p of this.pending.values()) void this.o.transport.send(p.frame as never).catch(() => undefined); /* same id, so a host that already has it answers with the existing seq */
  }
  private warnPush(kind: string, reason: string, seq?: number): void { this.set({ ...this.st, warnings: [...this.st.warnings, { kind, reason, ...(seq !== undefined ? { seq } : {}) }].slice(-WARNING_RING) }); }

  private onFrame(f: Frame): void {
    if (typeof f.seq !== 'number') return; /* presence and other unsequenced frames are not part of the transcript */
    const own = this.pending.get(String(f.id)); if (own && f.from === this.st.me.member) { this.pending.delete(String(f.id)); own.resolve(); }
    for (const g of this.ingest.push(f)) this.apply(g);
  }
  private apply(f: Frame): void {
    const r = this.o.decoder.decode(f);
    if (r.kind === 'ok') return this.set(reduceGuestState(this.st, r.frame));
    if (r.kind === 'drop') { this.set(reduceGuestState(this.st, { ...f, k: 'x.dropped', p: {}, ct: undefined } as Frame)); return this.warnPush(String(f.k), r.reason, f.seq); }
    const ev = this.wait.push(f); if (ev > 0) this.warnPush(String(f.k), 'key_wait_evicted', f.seq); this.set({ ...this.st, lastSeq: Math.max(this.st.lastSeq, f.seq ?? 0), phase: 'waiting_for_key' });
  }
  /** The key grant was opened: everything that waited is decoded in order in one pass. */
  keyArrived(): void {
    const frames = this.wait.drain().sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)); let s = this.st; const was = s.phase;
    for (const f of frames) { const r = this.o.decoder.decode(f); if (r.kind === 'ok') s = reduceGuestState(s, r.frame); else if (r.kind === 'wait_key') this.wait.push(f); }
    const transcript = [...s.transcript].sort((a, b) => a.seq - b.seq); this.set({ ...s, transcript, phase: this.wait.size > 0 ? 'waiting_for_key' : was === 'waiting_for_key' ? (s.roster.length ? 'live' : 'connecting') : s.phase });
  }

  private onClosed(c: { code: number; willReconnect: boolean }): void {
    if (this.left) return; const e = transportCloseError(c);
    if (c.code === 4403) return this.set({ ...this.st, phase: 'kicked' });
    if (c.code === 4404 || c.code === 4410 || c.code === 1000) return this.set({ ...this.st, phase: 'ended' });
    if (c.code === 4426) { this.warnPush('close', 'client_too_old'); return this.set({ ...this.st, phase: 'ended' }); }
    for (const p of this.pending.values()) void p;
    this.set({ ...this.st, phase: this.st.phase === 'ended' || this.st.phase === 'kicked' ? this.st.phase : 'reconnecting' });
    if (c.code === 4401) { if (this.refreshed) { this.warnPush('close', 'token_invalid'); return this.set({ ...this.st, phase: 'ended' }); } this.refreshed = true; void (this.o.refreshTicket?.() ?? Promise.resolve()).then(() => this.o.transport.connect()).catch(() => this.warnPush('close', 'refresh_failed')); return; }
    if (c.willReconnect) return; if (e && c.code >= 4400) return; /* other typed refusals are not retried */
    const jitter = Math.floor((this.o.random ?? Math.random)() * 250); this.o.clock.setTimeout(() => { if (!this.left) void this.o.transport.connect().catch(() => undefined); }, 250 + jitter);
  }

  /* ------------------------------------------------------------- what a guest can do */
  async submit(body: string, kind: 'message' | 'command' = 'message'): Promise<string> {
    const me = this.st.me; if (me.role === 'viewer') throw err('forbidden', 403); if (me.muted) throw err('forbidden', 403); if (this.st.phase === 'ended' || this.st.phase === 'kicked') throw err('forbidden', 403);
    if (this.st.queue.items.filter((i) => i.submitter === me.member && LIVE_STATES.has(i.state)).length + [...this.pending.values()].filter((p) => p.frame.k === 'queue.submit').length >= MEMBER_CAP) throw err('queue_full', 429);
    const ct = await this.o.sealBody(body); const item = this.o.ids.que(); const size = Buffer.from(ct.c, 'base64').length; const unsigned = { v: 1, t: 'queue', k: 'queue.submit', id: this.o.ids.msg(), sid: this.o.sid, p: { item, size, kind }, ct } as unknown as Frame; const frame = { ...unsigned, sig: await this.o.sign(unsigned) } as Frame;
    await this.sendAndWait(frame); return item;
  }
  async cancel(item: string): Promise<void> {
    const it = this.st.queue.items.find((i) => i.item === item); if (!it) throw err('queue_item_gone', 404); if (it.submitter !== this.st.me.member) throw err('forbidden', 403); if (it.state !== 'queued' && it.state !== 'approved') throw err('queue_item_gone', 404);
    await this.sendAndWait({ v: 1, t: 'queue', k: 'queue.cancel', id: this.o.ids.msg(), sid: this.o.sid, p: { item } } as unknown as Frame);
  }
  private sendAndWait(frame: Frame): Promise<void> { return new Promise<void>((resolve, reject) => { this.pending.set(String(frame.id), { frame, resolve, reject }); this.o.transport.send(frame as never).catch((e: unknown) => { if (this.st.phase === 'live') { this.pending.delete(String(frame.id)); reject(e); } /* offline: it stays pending and goes out again with the same id after the welcome */ }); }); }
  async leave(): Promise<void> { this.left = true; for (const o of this.off) o(); this.off = []; for (const p of this.pending.values()) p.reject(err('forbidden', 403)); this.pending.clear(); await this.o.transport.close(); this.set({ ...this.st, phase: 'ended' }); }
}
