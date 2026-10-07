/** Send-side shaping (CT-WS-ENVELOPE "Limits"): token buckets from welcome.limits, the sys.slow_down pause and the 2 MiB outbound cap.
 *  Owns the outbound queues. Must not: look inside a frame beyond its type, or grow past the byte cap. */
import type { RelayClock } from './heartbeat.js';
import { OutboundBufferFullError } from './errors.js';

export const MAX_FRAME_BYTES = 256 * 1024;
export const OUTBOUND_BUFFER_BYTES = 2 * 1024 * 1024;
/** A sys.slow_down asking for longer than this is capped. */
export const MAX_SLOW_DOWN_MS = 60_000;
/** While the socket's own buffer is over the cap, check again this often. */
const DRAIN_POLL_MS = 50;

export interface SendLimits { seqRate: number; seqBurst: number; presenceRate: number; presenceBurst: number; maxFrameBytes: number }
export const DEFAULT_SEND_LIMITS: SendLimits = { seqRate: 30, seqBurst: 100, presenceRate: 10, presenceBurst: 10, maxFrameBytes: MAX_FRAME_BYTES };

const pos = (v: unknown, fallback: number, max = Infinity): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, max) : fallback);
/** Read welcome.limits (unknown keys ignored, bad values fall back to the defaults). The frame size never goes above 256 KiB. */
export function limitsFromWelcome(raw: unknown): SendLimits {
  const l = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>; const presenceRate = pos(l.presence_rate, DEFAULT_SEND_LIMITS.presenceRate, 1000);
  return { seqRate: pos(l.seq_rate, DEFAULT_SEND_LIMITS.seqRate, 1000), seqBurst: pos(l.seq_burst, DEFAULT_SEND_LIMITS.seqBurst, 10_000), presenceRate, presenceBurst: Math.max(1, Math.ceil(presenceRate)), maxFrameBytes: Math.floor(pos(l.max_frame_bytes, MAX_FRAME_BYTES, MAX_FRAME_BYTES)) };
}

/** Classic token bucket: `burst` tokens, refilled at `rate` per second. */
export class TokenBucket {
  private tokens: number; private at: number;
  constructor(private rate: number, private burst: number, now: number) { this.tokens = burst; this.at = now; }
  private refill(now: number): void { if (now > this.at) { this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) * this.rate) / 1000); this.at = now; } }
  tryTake(now: number): boolean { this.refill(now); if (this.tokens >= 1) { this.tokens -= 1; return true; } return false; }
  /** How long until one token is there. */
  msUntilToken(now: number): number { this.refill(now); return this.tokens >= 1 ? 0 : Math.ceil(((1 - this.tokens) * 1000) / this.rate); }
  setRate(rate: number, burst: number, now: number): void { this.refill(now); this.rate = rate; this.burst = burst; this.tokens = Math.min(this.tokens, burst); }
}

/** `seq`: event/queue/control frames. `presence`: presence frames. `other`: sys.* and ack (no bucket, but paused by slow_down). */
export type SendClass = 'seq' | 'presence' | 'other';
export const sendClassOf = (t: string): SendClass => (t === 'event' || t === 'queue' || t === 'control' ? 'seq' : t === 'presence' ? 'presence' : 'other');

interface Item { text: string; bytes: number; resolve: () => void; reject: (e: unknown) => void }
export interface SendLimiterOptions {
  clock: RelayClock;
  /** writes one text frame to the socket; resolves when written */
  write: (text: string) => Promise<void>;
  /** bytes the socket itself still holds (ws bufferedAmount) */
  bufferedAmount: () => number;
  limits?: SendLimits; bufferBytes?: number;
}

/** One FIFO per class, so presence never blocks sequenced frames. A frame is written when the pause is over, its bucket has a token and the socket buffer is under the cap. */
export class SendLimiter {
  private readonly q: Record<SendClass, Item[]> = { other: [], seq: [], presence: [] };
  private queued = 0; private pausedUntil = 0; private timer: unknown; private timerAt = Infinity;
  private seq: TokenBucket; private presence: TokenBucket;
  readonly bufferBytes: number;
  constructor(private readonly o: SendLimiterOptions) {
    const l = o.limits ?? DEFAULT_SEND_LIMITS; const now = o.clock.now(); this.bufferBytes = o.bufferBytes ?? OUTBOUND_BUFFER_BYTES;
    this.seq = new TokenBucket(l.seqRate, l.seqBurst, now); this.presence = new TokenBucket(l.presenceRate, l.presenceBurst, now);
  }
  /** Bytes waiting in the queues (not yet handed to the socket). */
  get queuedBytes(): number { return this.queued; }
  get pausedForMs(): number { return Math.max(0, this.pausedUntil - this.o.clock.now()); }

  setLimits(l: SendLimits): void { const now = this.o.clock.now(); this.seq.setRate(l.seqRate, l.seqBurst, now); this.presence.setRate(l.presenceRate, l.presenceBurst, now); }

  /** Queue a frame. Rejects at once with OutboundBufferFullError when queued + socket-buffered + this frame would pass the cap. */
  submit(cls: SendClass, text: string, bytes: number): Promise<void> {
    if (this.queued + this.o.bufferedAmount() + bytes > this.bufferBytes) return Promise.reject(new OutboundBufferFullError(this.bufferBytes));
    return new Promise<void>((resolve, reject) => { this.q[cls].push({ text, bytes, resolve, reject }); this.queued += bytes; this.pump(); });
  }

  /** sys.slow_down: hold every send for `ms` (capped at 60 s). A longer pause already running is kept. */
  pauseFor(ms: number): void {
    const until = this.o.clock.now() + Math.max(0, Math.min(ms, MAX_SLOW_DOWN_MS)); if (until > this.pausedUntil) this.pausedUntil = until;
    this.wake(this.pausedUntil - this.o.clock.now(), true);
  }
  /** New connection: the old pause no longer applies. */
  resume(): void { this.pausedUntil = 0; this.pump(); }

  /** The socket went away: reject everything queued with `err`. */
  failAll(err: unknown): void {
    this.clearTimer();
    for (const cls of ['other', 'seq', 'presence'] as const) for (const it of this.q[cls].splice(0)) it.reject(err);
    this.queued = 0;
  }

  private clearTimer(): void { if (this.timer !== undefined) this.o.clock.clearTimeout(this.timer as never); this.timer = undefined; this.timerAt = Infinity; }
  /** Run pump() after `ms`; an earlier wake-up already set wins unless `force` (a pause moves the wake-up later). */
  private wake(ms: number, force = false): void {
    const at = this.o.clock.now() + ms; if (!force && this.timer !== undefined && this.timerAt <= at) return;
    this.clearTimer(); this.timerAt = at; this.timer = this.o.clock.setTimeout(() => { this.timer = undefined; this.timerAt = Infinity; this.pump(); }, ms);
  }

  private pump(): void {
    const now = this.o.clock.now(); let wait = Infinity;
    if (now < this.pausedUntil) { this.wake(this.pausedUntil - now, true); return; }
    for (const cls of ['other', 'seq', 'presence'] as const) {
      const queue = this.q[cls]; const bucket = cls === 'seq' ? this.seq : cls === 'presence' ? this.presence : undefined;
      while (queue.length) {
        if (this.o.bufferedAmount() > this.bufferBytes) { wait = Math.min(wait, DRAIN_POLL_MS); break; }
        if (bucket && !bucket.tryTake(now)) { wait = Math.min(wait, Math.max(1, bucket.msUntilToken(now))); break; }
        const it = queue.shift()!; this.queued -= it.bytes;
        this.o.write(it.text).then(it.resolve, it.reject);
      }
    }
    if (wait !== Infinity) this.wake(wait);
  }
}
