/** What to do when the relay closes the WebSocket (CT-WS-ENVELOPE close codes). */
export type CloseAction = { action: 'reconnect' | 'stop' | 'refresh_token' | 'upgrade_required'; backoff: boolean; honourRetryAfter?: boolean; tellUser?: boolean };

export function closeCodeAction(code: number): CloseAction {
  switch (code) {
    case 1000: case 1001: return { action: 'reconnect', backoff: true };
    case 4400: return { action: 'stop', backoff: false }; // we sent something invalid: a bug, do not loop
    case 4401: return { action: 'refresh_token', backoff: false };
    case 4403: case 4404: return { action: 'stop', backoff: false, tellUser: true };
    case 4409: return { action: 'stop', backoff: false }; // superseded by another connection of this device; reconnecting would start a loop
    case 4426: return { action: 'upgrade_required', backoff: false, tellUser: true };
    case 4503: return { action: 'reconnect', backoff: true, honourRetryAfter: true };
    case 4408: case 4429: return { action: 'reconnect', backoff: true };
    default: return { action: 'reconnect', backoff: true }; // unknown 4xxx and everything abnormal (1006, 1011...): try again, slowly
  }
}
/** WebSocket reconnect delay: 250 ms x 2^n, full jitter, cap 15 s (CT-WS-ENVELOPE). */
export const wsBackoffMs = (attempt: number, rng: () => number = Math.random): number => Math.round(rng() * Math.min(15_000, 250 * 2 ** Math.max(0, attempt)));
