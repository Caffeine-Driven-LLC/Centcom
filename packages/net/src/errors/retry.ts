/** The retry table from CT-ERR, as pure functions. */
const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);
export const MAX_ATTEMPTS = 5; export const BASE_DELAY_MS = 500; export const MAX_DELAY_MS = 30_000;
/** A server asking us to wait longer than this is shown to the person, not slept through. */
export const MAX_AUTO_WAIT_S = 120;

export interface RetryInput { status: number; method: string; hasIdempotencyKey: boolean; attempt: number; authRefreshed: boolean; code?: string; retryAfterS?: number }
export interface RetryDecision { retry: boolean; reason: string; refreshAuth?: boolean }

/** 401s that mean "this token is finished": refreshing will not help. */
const HARD_AUTH = new Set(['token_invalid', 'token_revoked', 'device_revoked', 'refresh_reuse_detected', 'invalid_client', 'invalid_grant']);

/** `attempt` is how many tries have been made so far (1 after the first failure). */
export function retryDecision(i: RetryInput): RetryDecision {
  const m = i.method.toUpperCase();
  if (i.status === 401) {
    if (i.code && HARD_AUTH.has(i.code)) return { retry: false, reason: 'auth_ended' };
    return i.authRefreshed ? { retry: false, reason: 'reauthenticate' } : { retry: true, refreshAuth: true, reason: 'refresh_token_once' };
  }
  if ([400, 403, 404, 409, 410, 422].includes(i.status)) return { retry: false, reason: 'fix_the_request' };
  const transient = [408, 425, 429].includes(i.status); const server = [500, 502, 503, 504].includes(i.status);
  if (!transient && !server) return { retry: false, reason: 'not_retryable' };
  if (i.attempt >= MAX_ATTEMPTS) return { retry: false, reason: 'max_attempts' };
  if (i.retryAfterS !== undefined && i.retryAfterS > MAX_AUTO_WAIT_S) return { retry: false, reason: 'retry_after_too_long' };
  if (server && !(IDEMPOTENT.has(m) || i.hasIdempotencyKey)) return { retry: false, reason: 'not_idempotent' };
  return { retry: true, reason: transient ? 'transient' : 'server_error' };
}

/** Honour Retry-After (plus up to 500 ms of jitter so a crowd does not return in lockstep); otherwise full-jitter exponential, base 500 ms, cap 30 s. */
export function backoffDelayMs(attempt: number, retryAfterS: number | undefined, rng: () => number = Math.random): number {
  if (retryAfterS !== undefined && retryAfterS >= 0) return Math.round(retryAfterS * 1000 + rng() * 500);
  const cap = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt)); return Math.round(rng() * cap);
}
