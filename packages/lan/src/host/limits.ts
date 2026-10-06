/** The LAN host enforces the same limits as the hosted relay (CT-LAN section 3). */
export const HELLO_TIMEOUT_MS = 5000; export const PING_MS = 20_000; export const DEAD_MS = 50_000; export const MAX_FRAME_BYTES = 262_144; export const MAX_MEMBERS = 8;
export const OUTBOUND_LIMIT_BYTES = 2 * 1024 * 1024; export const SEQ_RATE = 30; export const SEQ_BURST = 100; export const PRESENCE_RATE = 10; export const INVALID_PER_MINUTE = 10;
export const REPLAY_MIN_FRAMES = 5000; export const REPLAY_MIN_MS = 10 * 60_000; export const DEDUPE_MS = 24 * 3_600_000; export const PRESENCE_FLUSH_MS = 500; export const CURSOR_FLUSH_MS = 100; export const TYPING_CLEAR_MS = 5000;
export const HOST_DEFAULT_PORT = 7070; export const SLOW_DOWN_MS = 1000;

/** A token bucket on the injected clock: `burst` tokens, refilled at `rate` a second. */
export class Bucket {
  private tokens: number; private at: number;
  constructor(private readonly rate: number, private readonly burst: number, now: number) { this.tokens = burst; this.at = now; }
  take(now: number): boolean { this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.rate); this.at = now; if (this.tokens >= 1) { this.tokens -= 1; return true; } return false; }
}
