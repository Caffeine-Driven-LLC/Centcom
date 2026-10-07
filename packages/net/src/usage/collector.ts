/** The usage reporter (lane C065): collects hosted-session usage (from the bus and from the C029 ledger's outbox), keeps it in the
 *  durable spool and reports it in batches. Client-reported usage is informational only (CT-API-USAGE, CT-ENTITLEMENTS §5).
 *  Must not: block, slow or fail an agent turn (`record()` is synchronous and never throws), report LAN or local usage, send anything
 *  while logged out, use usage numbers to enforce anything, or let reaching a quota stop local or LAN work or reporting. */
import { isId } from '@centcom/protocol';
import type { HttpClient, HttpClock, IdGenerator } from '../http/types.js';
import type { Logger } from '../log/index.js';
import { USAGE_MAX_BATCH_EVENTS, UsageBatcher, type FlushResult } from './batcher.js';
import { QuotaTracker, type QuotaState, type SessionNotice } from './quota-state.js';
import { UsageSpool, USAGE_ID_RE, USAGE_TYPES, type UsageEvent } from './spool.js';

/** What `record()` takes. An `id` is optional: a valid `use_` id (for example the ledger's) is kept so a resend dedupes server-side. */
export type UsageEventInput = Omit<UsageEvent, 'id'> & { id?: string };
/** Events the reporter listens to. Any bus with this map fits (for example `createBus<UsageBusEvents>` from @centcom/agent). */
export interface UsageBusEvents { 'usage.event': UsageEventInput; 'net.reconnected': unknown; 'session.notice': SessionNotice }
export interface UsageBus { on<K extends keyof UsageBusEvents>(k: K, h: (p: UsageBusEvents[K]) => unknown): () => void }
/** The C029 ledger's outbox as seen from here (its `dequeueBatch`/`ack`/`requeue`). Events are moved into the spool, then acked there. */
export interface UsageSource { dequeueBatch(max?: number): UsageEventInput[]; ack(ids: string[]): Promise<void>; requeue(ids: string[]): void }

export interface UsageReporterOptions {
  http: HttpClient;
  bus?: UsageBus;
  /** the state directory's `usage/` folder; the spool is `spool.jsonl` in it */
  spoolDir: string;
  clock: HttpClock;
  ids: IdGenerator;
  isLoggedIn: () => boolean;
  /** Only hosted (relay) sessions are reported. Default: none is, so nothing is sent until the session layer says which are. */
  isHostedSession?: (sessionId: string) => boolean;
  /** pulled into the spool before every flush */
  source?: UsageSource;
  /** default 30000 */
  flushIntervalMs?: number;
  /** default and maximum 500 */
  maxBatch?: number;
  logger?: Logger;
  rng?: () => number;
}

export const DEFAULT_FLUSH_INTERVAL_MS = 30_000;
/** A flush starts as soon as this many unbatched events are waiting. */
export const FLUSH_AT_EVENTS = 100;
/** `stop()` gives the final flush this long. */
export const STOP_DEADLINE_MS = 5_000;

export class UsageReporter {
  private readonly spool: UsageSpool; private readonly batcher: UsageBatcher; private readonly tracker: QuotaTracker; private readonly log?: Logger;
  private timer: unknown; private wake: unknown; private unsubs: (() => void)[] = []; private started = false; private warnedLoggedOut = false; private soon = false;
  private abort = new AbortController();
  /** events refused at `record()`: not from a hosted session, logged out, or malformed */
  skipped = { local: 0, loggedOut: 0, invalid: 0 };

  constructor(private readonly o: UsageReporterOptions) {
    this.log = o.logger?.child({ component: 'usage' });
    this.spool = new UsageSpool(o.spoolDir, { logger: this.log }); this.tracker = new QuotaTracker(o.clock);
    this.batcher = new UsageBatcher({ http: o.http, spool: this.spool, clock: o.clock, ids: o.ids, quota: this.tracker, rng: o.rng, logger: this.log, maxBatch: o.maxBatch ?? USAGE_MAX_BATCH_EVENTS, canSend: () => this.o.isLoggedIn() });
  }

  /** Open the spool (sending what a previous run left), listen to the bus and flush every 30 s. */
  start(): void {
    if (this.started) return; this.started = true; this.abort = new AbortController(); this.spool.open();
    const bus = this.o.bus;
    if (bus) this.unsubs.push(bus.on('usage.event', (e) => this.record(e)), bus.on('net.reconnected', () => this.reconnected()), bus.on('session.notice', (n) => this.handleNotice(n)));
    this.arm(); if (this.spool.size()) this.flushSoon();
  }

  /** Final flush, bounded at 5 s; whatever is not acknowledged by then stays in the spool for the next run. */
  async stop(): Promise<void> {
    if (!this.started) return; this.started = false;
    this.unsubs.forEach((u) => u()); this.unsubs = []; this.clear();
    const deadline = this.o.clock.setTimeout(() => this.abort.abort(new Error('stop deadline')), STOP_DEADLINE_MS);
    try { await this.flush(); } catch { /* flush never throws, but stop must not either */ } finally { this.o.clock.clearTimeout(deadline as never); }
    this.tracker.dispose(); this.spool.close();
  }

  /** Synchronous, never throws, never waits. Keeps the event only for a hosted session while logged in. */
  record(e: UsageEventInput): void {
    try {
      if (!this.o.isLoggedIn()) {
        this.skipped.loggedOut++; if (!this.warnedLoggedOut) { this.warnedLoggedOut = true; this.log?.warn('usage.logged_out_discarding'); }
        return;
      }
      this.warnedLoggedOut = false;
      const sid = e?.session_id;
      if (typeof sid !== 'string' || !isId('ses', sid) || !(this.o.isHostedSession?.(sid) ?? false)) { this.skipped.local++; return; }
      if (typeof e.type !== 'string' || !USAGE_TYPES.has(e.type) || typeof e.qty !== 'number' || !Number.isInteger(e.qty) || e.qty < 0 || e.qty > Number.MAX_SAFE_INTEGER) { this.skipped.invalid++; return; }
      const at = typeof e.at === 'string' && Number.isFinite(Date.parse(e.at)) ? new Date(Date.parse(e.at)).toISOString() : new Date(this.o.clock.now()).toISOString();
      const ev: UsageEvent = { id: typeof e.id === 'string' && USAGE_ID_RE.test(e.id) ? e.id : this.o.ids.next('use'), type: e.type, qty: e.qty, at, session_id: sid };
      if (isId('agt', e.agent_id)) ev.agent_id = e.agent_id;
      this.spool.append(ev);
      if (this.started && this.spool.unbatched() >= FLUSH_AT_EVENTS) this.flushSoon();
    } catch (err) { this.skipped.invalid++; this.log?.debug('usage.record_failed', { kind: err instanceof Error ? err.name : 'unknown' }); }
  }

  /** Pull the ledger's outbox into the spool, then send everything that may be sent now. Never throws. */
  async flush(): Promise<FlushResult> {
    await this.drainSource();
    try { const r = await this.batcher.flush(this.abort.signal); this.armWake(); return r; } catch { return { sent: 0, kept: this.spool.size() }; }
  }

  /** The connection is back: send what waited. */
  reconnected(): void { if (this.started) this.flushSoon(); }

  quota(): QuotaState { return this.tracker.quota(); }
  onQuota(fn: (q: QuotaState) => void): () => void { return this.tracker.onQuota(fn); }
  /** Wire to session notices: usage_warning and quota_reached. Reporting goes on either way. */
  handleNotice(n: SessionNotice): void { this.tracker.handleNotice(n); }
  /** Feed `quota_exceeded` errors from other calls (for example session create). */
  handleError(e: unknown): boolean { return this.tracker.handleError(e); }
  /** Hosted actions only: false while the quota is reached. */
  allowsHostedActions(): boolean { return this.tracker.allowsHostedActions(); }

  /** Diagnostics: counts only. */
  stats(): { pending: number; dropped: number; poisoned: number; memoryOnly: boolean; pausedUntil: string | null; skipped: { local: number; loggedOut: number; invalid: number } } {
    const p = this.batcher.notBefore > this.o.clock.now() ? new Date(this.batcher.notBefore).toISOString() : null;
    return { pending: this.spool.size(), dropped: this.spool.dropped, poisoned: this.batcher.poisoned, memoryOnly: this.spool.isMemoryOnly(), pausedUntil: p, skipped: { ...this.skipped } };
  }
  get dropped(): number { return this.spool.dropped; }
  get poisoned(): number { return this.batcher.poisoned; }

  private async drainSource(): Promise<void> {
    const src = this.o.source; if (!src) return;
    for (let round = 0; round < 40; round++) { /* at most 20,000 events per flush, so a busy ledger cannot keep us here */
      let batch: UsageEventInput[]; try { batch = src.dequeueBatch(USAGE_MAX_BATCH_EVENTS); } catch { return; }
      if (!batch.length) return;
      for (const e of batch) this.record(e); /* local, LAN and logged-out events are refused here, by design */
      const ids = batch.map((e) => e.id).filter((x): x is string => typeof x === 'string');
      try { await src.ack(ids); } catch { try { src.requeue(ids); } catch { /* the ledger keeps them in its file */ } return; }
    }
  }
  private flushSoon(): void { if (this.soon) return; this.soon = true; void Promise.resolve().then(async () => { this.soon = false; await this.flush(); }); }
  private arm(): void {
    const ms = Math.max(1_000, this.o.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
    this.timer = this.o.clock.setTimeout(() => { this.timer = undefined; if (!this.started) return; void this.flush().finally(() => { if (this.started) this.arm(); }); }, ms);
  }
  /** After a pause or a backoff, flush the moment it ends rather than at the next tick. */
  private armWake(): void {
    if (!this.started || this.wake !== undefined) return; const wait = this.batcher.notBefore - this.o.clock.now(); if (wait <= 0 || !this.spool.size()) return;
    this.wake = this.o.clock.setTimeout(() => { this.wake = undefined; if (this.started) void this.flush(); }, wait);
  }
  private clear(): void {
    if (this.timer !== undefined) this.o.clock.clearTimeout(this.timer as never); if (this.wake !== undefined) this.o.clock.clearTimeout(this.wake as never); this.timer = undefined; this.wake = undefined;
  }
}
