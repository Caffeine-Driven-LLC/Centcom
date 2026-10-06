/** The CT-ERR retry table as the HTTP client applies it. Pure functions; the client does the sleeping.
 *  Must not: retry a POST that has no Idempotency-Key, sleep through a long Retry-After, or let one logical request wait more than 60 s in total. */
import { BASE_DELAY_MS, MAX_ATTEMPTS, MAX_DELAY_MS } from '../errors/retry.js';

/** The most total sleep one logical request may spend between attempts. */
export const MAX_TOTAL_SLEEP_MS = 60_000;
/** A Retry-After above this is handed to the caller (for example quota_exceeded's 3600 s), not slept through. */
export const MAX_RETRY_AFTER_S = MAX_DELAY_MS / 1000;

const TRANSIENT = new Set([408, 425, 429]);
const SERVER = new Set([500, 502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);

export interface HttpRetryInput {
  method: string; hasIdempotencyKey: boolean;
  /** attempts made so far, including the one that just failed */
  attempt: number; maxAttempts?: number;
  /** HTTP status, or a transport failure */
  status?: number; transport?: 'offline' | 'timeout' | 'aborted' | 'tls' | 'bad_response';
  retryAfterS?: number;
  /** total ms already slept for this logical request */
  sleptMs?: number;
}
export type HttpRetryReason = 'transient' | 'server_error' | 'network' | 'not_retryable' | 'not_idempotent' | 'max_attempts' | 'retry_after_too_long' | 'sleep_budget';
export interface HttpRetryDecision { retry: boolean; reason: HttpRetryReason; delayMs?: number }

/** May this request be sent again without risk of doing the work twice? */
export const retrySafe = (method: string, hasIdempotencyKey: boolean): boolean => IDEMPOTENT_METHODS.has(method.toUpperCase()) || hasIdempotencyKey;

/** Full jitter: attempt n (n tries made) sleeps uniformly in [0, min(30 s, 500 ms * 2^n)]. */
export const jitterDelayMs = (attempt: number, rng: () => number): number => Math.floor(rng() * Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt)));

/** Decide whether to retry and how long to wait first. 401 is not handled here (the client refreshes once). */
export function httpRetryDecision(i: HttpRetryInput, rng: () => number): HttpRetryDecision {
  const m = i.method.toUpperCase(); const safe = retrySafe(m, i.hasIdempotencyKey);
  let reason: HttpRetryReason;
  if (i.transport !== undefined) {
    /* an abort is the caller's choice, TLS will not fix itself, and a bad 2xx body is not a transient fault */
    if (i.transport === 'aborted' || i.transport === 'tls' || (i.transport === 'bad_response' && i.status === undefined)) return { retry: false, reason: 'not_retryable' };
  }
  if (i.status !== undefined && TRANSIENT.has(i.status)) reason = 'transient';
  else if (i.status !== undefined && SERVER.has(i.status)) reason = 'server_error';
  else if (i.status === undefined && (i.transport === 'offline' || i.transport === 'timeout')) reason = 'network';
  else return { retry: false, reason: 'not_retryable' };
  /* CT-ERR: POST requests are retried only if they carry an Idempotency-Key, whatever the status */
  if (m === 'POST' && !i.hasIdempotencyKey) return { retry: false, reason: 'not_idempotent' };
  if (reason !== 'transient' && !safe) return { retry: false, reason: 'not_idempotent' };
  if (i.attempt >= Math.min(i.maxAttempts ?? MAX_ATTEMPTS, MAX_ATTEMPTS)) return { retry: false, reason: 'max_attempts' };
  if (i.retryAfterS !== undefined && i.retryAfterS > MAX_RETRY_AFTER_S) return { retry: false, reason: 'retry_after_too_long' };
  const delayMs = i.retryAfterS !== undefined && i.retryAfterS >= 0 ? Math.round(i.retryAfterS * 1000) : jitterDelayMs(i.attempt, rng);
  if ((i.sleptMs ?? 0) + delayMs > MAX_TOTAL_SLEEP_MS) return { retry: false, reason: 'sleep_budget' };
  return { retry: true, reason, delayMs };
}
