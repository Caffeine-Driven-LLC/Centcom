/** What the relay client does after each WebSocket close code (CT-WS-ENVELOPE "Close codes" and "Reconnection").
 *  Pure data and one lookup. Must not: decide delays (reconnect.ts) or touch a socket. */
import type { ErrorCode } from '@centcom/protocol';

/** `no`: stop for good. `backoff`: 250 ms x 2^n with full jitter. `immediate`: jittered, under 250 ms. `after_retry_after`: wait the `retry_after_s` of the preceding sys.error, then backoff. `refresh_once`: ask for fresh auth, retry once. */
export type ReconnectMode = 'no' | 'backoff' | 'immediate' | 'after_retry_after' | 'refresh_once';
/** `userFacing` is the key into the C006 message table for what to tell the person. */
export interface ClosePolicy { reconnect: ReconnectMode; userFacing?: ErrorCode }

/** Every code in the CT-WS-ENVELOPE table. Codes not listed (1006, 1011, unknown 4xxx) back off. */
export const CLOSE_POLICY: Record<number, ClosePolicy> = {
  1000: { reconnect: 'backoff' },
  1001: { reconnect: 'immediate' },
  4400: { reconnect: 'backoff', userFacing: 'protocol_violation' },
  4401: { reconnect: 'refresh_once', userFacing: 'ticket_invalid' },
  4403: { reconnect: 'no', userFacing: 'forbidden' },
  4404: { reconnect: 'no', userFacing: 'session_not_found' },
  4408: { reconnect: 'backoff' },
  4409: { reconnect: 'no' },
  4426: { reconnect: 'no', userFacing: 'client_too_old' },
  4429: { reconnect: 'backoff', userFacing: 'slow_consumer' },
  4503: { reconnect: 'after_retry_after', userFacing: 'service_unavailable' },
};

/** 4400 backs off, but after this many within PROTOCOL_CLOSE_WINDOW_MS the client stops and reports a protocol error. */
export const MAX_PROTOCOL_CLOSES = 3;
export const PROTOCOL_CLOSE_WINDOW_MS = 60_000;

const FALLBACK: ClosePolicy = { reconnect: 'backoff' };
/** The policy for a close code; anything unknown or abnormal backs off. */
export const closePolicy = (code: number): ClosePolicy => CLOSE_POLICY[code] ?? FALLBACK;
