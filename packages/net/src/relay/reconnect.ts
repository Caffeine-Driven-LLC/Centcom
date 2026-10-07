/** The reconnect schedule (CT-WS-ENVELOPE "Reconnection"): delays, the attempt counter and the per-code decisions.
 *  Pure except for the injected rng and time. Must not: open sockets, fetch tickets or sleep. */
import { MAX_PROTOCOL_CLOSES, PROTOCOL_CLOSE_WINDOW_MS, closePolicy } from './close-codes.js';

export const BACKOFF_BASE_MS = 250;
export const BACKOFF_CAP_MS = 15_000;
/** 1001 (server restart) reconnects after a jitter of at most this. */
export const IMMEDIATE_MAX_MS = 250;
/** A connection that stayed ready this long resets the attempt counter, so a flapping server does not pin the delay at the cap. */
export const STABLE_RESET_MS = 10_000;
/** A server asking for more than this is still obeyed, but never longer (bounds every wait). */
export const MAX_RETRY_AFTER_MS = 3_600_000;

/** floor(rng() * min(15000, 250 * 2^attempt)): full jitter, so it lies in [0, cap). */
export function backoffDelayMs(attempt: number, rng: () => number): number {
  return Math.floor(rng() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, Math.min(attempt, 30))));
}

export interface ReconnectDecision {
  reconnect: boolean; delayMs: number;
  /** short machine reason for logs and tests: backoff, immediate, retry_after, refresh, stop_<code>, auth_failed, protocol_errors */
  reason: string;
  /** 4401: ask onAuthFailure() before the next attempt */
  refreshAuth?: boolean;
}

/** Remembers the attempt counter, consecutive 4401s and recent 4400s across attempts. */
export class ReconnectPlanner {
  /** n in 250 ms x 2^n; the next backoff uses it, then it goes up by one */
  attempt = 0;
  private auth401 = 0; private protocolCloses: number[] = [];
  constructor(private readonly rng: () => number, private readonly now: () => number) {}

  /** A welcome arrived: a later 4401 is no longer "consecutive". */
  onWelcome(): void { this.auth401 = 0; }
  /** The connection stayed ready for STABLE_RESET_MS. */
  resetAttempts(): void { this.attempt = 0; }
  /** A fresh start (connect() after a stop). */
  reset(): void { this.attempt = 0; this.auth401 = 0; this.protocolCloses = []; }

  private backoff(reason = 'backoff'): ReconnectDecision { const delayMs = backoffDelayMs(this.attempt, this.rng); this.attempt++; return { reconnect: true, delayMs, reason }; }

  /** A failure on our side (no welcome in time, dead connection, ticket fetch failed, socket error): always backoff. */
  local(): ReconnectDecision { return this.backoff(); }
  /** We asked for the reconnect ourselves (gap recovery): jittered, short. */
  requested(): ReconnectDecision { return { reconnect: true, delayMs: Math.floor(this.rng() * IMMEDIATE_MAX_MS), reason: 'requested' }; }

  /** The server closed with `code`; `retryAfterS` comes from the sys.error just before it, if any. */
  decide(code: number, retryAfterS?: number): ReconnectDecision {
    const p = closePolicy(code);
    switch (p.reconnect) {
      case 'no': return { reconnect: false, delayMs: 0, reason: `stop_${code}` };
      case 'immediate': { const delayMs = Math.floor(this.rng() * IMMEDIATE_MAX_MS); this.attempt++; return { reconnect: true, delayMs, reason: 'immediate' }; }
      case 'refresh_once': {
        this.auth401++;
        if (this.auth401 >= 2) return { reconnect: false, delayMs: 0, reason: 'auth_failed' };
        return { ...this.backoff('refresh'), refreshAuth: true };
      }
      case 'after_retry_after': {
        const wait = retryAfterS !== undefined && Number.isFinite(retryAfterS) && retryAfterS > 0 ? Math.min(retryAfterS * 1000, MAX_RETRY_AFTER_MS) : 0;
        const b = this.backoff('retry_after'); return { ...b, delayMs: wait + b.delayMs };
      }
      default: {
        if (code === 4400) {
          const t = this.now(); this.protocolCloses = this.protocolCloses.filter((x) => t - x < PROTOCOL_CLOSE_WINDOW_MS); this.protocolCloses.push(t);
          if (this.protocolCloses.length >= MAX_PROTOCOL_CLOSES) return { reconnect: false, delayMs: 0, reason: 'protocol_errors' };
        }
        return this.backoff();
      }
    }
  }
}
