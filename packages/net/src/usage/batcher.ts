/** Sends the spool to `POST /v1/usage/events` (CT-API-USAGE): batches of at most 500 events and 1 MiB, one Idempotency-Key per batch
 *  kept until the server acknowledges it, requests spaced to at most 60 a minute, and the outcome rules of lane C065.
 *  Must not: merge or re-split a batch that has a key, send a changed body under an old key, retry a rejected batch forever,
 *  or wait without a bound (every wait is on the injected clock and can be cancelled). */
import { AuthExpiredError, ApiError, ContractViolationError, RequestTooLargeError, TransportError } from '../http/errors.js';
import { newIdempotencyKey } from '../http/idempotency.js';
import { jitterDelayMs } from '../http/retry.js';
import type { HttpClient, HttpClock, IdGenerator } from '../http/types.js';
import type { Logger } from '../log/index.js';
import type { QuotaTracker } from './quota-state.js';
import type { ReadyBatch, UsageSpool } from './spool.js';

export const USAGE_MAX_BATCH_EVENTS = 500;
export const USAGE_MAX_BATCH_BYTES = 1024 * 1024;
/** 60 requests a minute per device, spread evenly: one request start per second at most. */
export const MIN_REQUEST_GAP_MS = 1_000;
/** A 429 without `retry_after_s` pauses this long. */
export const DEFAULT_PAUSE_MS = 60_000;
/** Failure backoff never goes past this. */
export const MAX_BACKOFF_MS = 5 * 60_000;

export interface FlushResult { sent: number; kept: number }
export interface BatcherDeps { http: HttpClient; spool: UsageSpool; clock: HttpClock; ids: IdGenerator; quota: QuotaTracker; rng?: () => number; logger?: Logger; maxBatch?: number; canSend: () => boolean }

/** One logical sender. `flush()` is single-flight: a call while one runs gets the same promise. */
export class UsageBatcher {
  /** batches dropped because the server refused them for good (4xx other than 429) */
  poisoned = 0;
  /** no request before this time (429 Retry-After or failure backoff) */
  notBefore = 0;
  private lastStart = -Infinity; private failures = 0; private running?: Promise<FlushResult>;
  private readonly maxBatch: number; private readonly rng: () => number;

  constructor(private readonly d: BatcherDeps) {
    this.maxBatch = Math.max(1, Math.min(d.maxBatch ?? USAGE_MAX_BATCH_EVENTS, USAGE_MAX_BATCH_EVENTS));
    this.rng = d.rng ?? (() => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32);
  }

  /** Send every batch that may be sent now. Stops early when paused, backing off, logged out or cancelled; what is left stays in the spool. */
  flush(signal?: AbortSignal): Promise<FlushResult> {
    this.running ??= this.run(signal).finally(() => { this.running = undefined; });
    return this.running;
  }
  /** True while a flush is in progress. */
  busy(): boolean { return this.running !== undefined; }

  private async run(signal?: AbortSignal): Promise<FlushResult> {
    const { spool, clock } = this.d; let sent = 0; let rekeyed = new Set<string>();
    while (!signal?.aborted && this.d.canSend() && clock.now() >= this.notBefore) {
      const b = spool.next(this.maxBatch, USAGE_MAX_BATCH_BYTES, () => newIdempotencyKey(this.d.ids)); if (!b) break;
      try { await this.gate(signal); } catch { break; }
      this.lastStart = clock.now();
      const outcome = await this.send(b, signal, rekeyed);
      if (outcome === 'sent') { sent += b.events.length; rekeyed = new Set(); continue; }
      if (outcome === 'dropped' || outcome === 'retry') continue;
      break; /* kept: paused, backing off, logged out or cancelled */
    }
    return { sent, kept: spool.size() };
  }

  private async send(b: ReadyBatch, signal: AbortSignal | undefined, rekeyed: Set<string>): Promise<'sent' | 'dropped' | 'retry' | 'kept'> {
    const { spool, clock } = this.d; const log = this.d.logger;
    try {
      const r = await this.d.http.call('ingestUsageEvents', { body: b.body }, { idempotencyKey: b.key, ...(signal ? { signal } : {}) });
      spool.ack(b.key); this.failures = 0;
      const rejected = Array.isArray(r.data?.rejected) ? r.data.rejected.length : 0;
      log?.debug('usage.batch_sent', { events: b.events.length, accepted: r.data?.accepted, duplicates: r.data?.duplicates, rejected, replayed: r.replayed, request_id: r.requestId });
      return 'sent';
    } catch (e) {
      if (e instanceof TransportError && e.transport === 'aborted') return 'kept';
      if (e instanceof AuthExpiredError || (e instanceof ApiError && e.status === 401)) { log?.debug('usage.auth', { code: e.code }); return 'kept'; }
      if (e instanceof ApiError && e.status === 429) {
        this.d.quota.handleError(e);
        this.notBefore = clock.now() + (typeof e.retryAfterS === 'number' && e.retryAfterS >= 0 ? e.retryAfterS * 1000 : DEFAULT_PAUSE_MS);
        log?.info('usage.paused', { code: e.rawCode, retry_after_s: e.retryAfterS, request_id: e.requestId }); return 'kept';
      }
      if (e instanceof ApiError && e.status === 409 && e.rawCode === 'idempotency_conflict' && b.changed && !rekeyed.has(b.key)) {
        const k = newIdempotencyKey(this.d.ids); rekeyed.add(k); spool.rekey(b.key, k); log?.info('usage.rekeyed', { request_id: e.requestId }); return 'retry';
      }
      if (e instanceof ApiError && e.status !== undefined && e.status >= 400 && e.status < 500 && ![408, 425].includes(e.status)) return this.poison(b, e.rawCode, e.fieldErrors.map((f) => f.pointer), e.requestId);
      if (e instanceof RequestTooLargeError) return this.poison(b, 'payload_too_large', [], undefined);
      if (e instanceof ContractViolationError) { spool.ack(b.key); log?.warn('usage.contract_violation', { pointer: e.pointer, request_id: e.requestId }); return 'sent'; } /* a 2xx: the server took it */
      /* 5xx, 408, 425, offline, timeout, a proxy's page: keep the batch (same key, same body next time) and back off */
      this.failures = Math.min(this.failures + 1, 10);
      this.notBefore = clock.now() + Math.max(MIN_REQUEST_GAP_MS, Math.min(MAX_BACKOFF_MS, jitterDelayMs(this.failures, this.rng)));
      log?.debug('usage.kept', { status: e instanceof ApiError || e instanceof TransportError ? e.status : undefined, failures: this.failures }); return 'kept';
    }
  }

  /** A batch the server will never take: dropped so it cannot block the ones behind it. Only the code and field pointers are logged. */
  private poison(b: ReadyBatch, code: string, pointers: string[], requestId: string | undefined): 'dropped' {
    this.d.spool.ack(b.key); this.poisoned++;
    this.d.logger?.warn('usage.batch_dropped', { code, pointers: pointers.slice(0, 10), events: b.events.length, request_id: requestId });
    return 'dropped';
  }

  /** Wait until a second has passed since the last request started. */
  private gate(signal?: AbortSignal): Promise<void> {
    const wait = this.lastStart + MIN_REQUEST_GAP_MS - this.d.clock.now(); if (wait <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('aborted'));
      const onAbort = () => { this.d.clock.clearTimeout(h as never); reject(new Error('aborted')); };
      const h = this.d.clock.setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, wait);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
