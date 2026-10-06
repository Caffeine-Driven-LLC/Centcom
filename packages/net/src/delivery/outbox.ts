/** Outbound reliability (CT-WS-ENVELOPE): sequenced frames we sent and the server has not echoed yet, keyed by id, in send order.
 *  Pure bookkeeping: no timers, no I/O. Must not: change an id, drop a frame that was not echoed (stuck frames stay), or pass its caps. */
import type { Frame } from '@centcom/protocol';
import { CentcomError } from '../errors/index.js';

export const MAX_UNACKED = 1000;
export const MAX_UNACKED_BYTES = 8 * 1024 * 1024;
/** Resend a frame that has gone this long without its echo... */
export const RESEND_AFTER_MS = 30_000;
/** ...at most this many times, then report it stuck (it stays for the next reconnect). */
export const MAX_RESENDS = 3;

/** The outbox is at its frame or byte cap; nothing was queued. */
export class OutboxFullError extends CentcomError {
  readonly count: number; readonly bytes: number;
  constructor(count: number, bytes: number, which: 'frames' | 'bytes') { super({ kind: 'protocol', code: 'slow_consumer' }); this.name = 'OutboxFullError'; this.message = `outbox full (${which}): ${count} frames, ${bytes} bytes unacked`; this.count = count; this.bytes = bytes; }
}

export interface OutboxEntry {
  readonly id: string; readonly frame: Frame; readonly bytes: number; readonly promise: Promise<{ id: string; seq: number }>;
  /** connection number of the first write (null until written) */
  firstConn: number | null;
  /** clock time of the last write (null until written) */
  lastSentAt: number | null;
  /** periodic resends since the last welcome */
  resends: number; stuck: boolean;
}
interface Internal extends OutboxEntry { resolve: (v: { id: string; seq: number }) => void; reject: (e: unknown) => void }

export class Outbox {
  private readonly m = new Map<string, Internal>(); private total = 0;
  constructor(private readonly o: { maxCount?: number; maxBytes?: number } = {}) {}
  get size(): number { return this.m.size; }
  get bytes(): number { return this.total; }
  has(id: string): boolean { return this.m.has(id); }
  get(id: string): OutboxEntry | undefined { return this.m.get(id); }
  /** In original send order. */
  list(): OutboxEntry[] { return [...this.m.values()]; }

  /** Track a frame until its echo. The same id twice returns the first promise (a caller re-submitting is not a new frame). */
  add(frame: Frame & { id: string }, bytes: number): { entry: OutboxEntry; fresh: boolean } {
    const prev = this.m.get(frame.id); if (prev) return { entry: prev, fresh: false };
    const max = this.o.maxCount ?? MAX_UNACKED; const maxB = this.o.maxBytes ?? MAX_UNACKED_BYTES;
    if (this.m.size >= max) throw new OutboxFullError(this.m.size, this.total, 'frames');
    if (this.total + bytes > maxB) throw new OutboxFullError(this.m.size, this.total, 'bytes');
    let resolve!: Internal['resolve']; let reject!: Internal['reject'];
    const promise = new Promise<{ id: string; seq: number }>((res, rej) => { resolve = res; reject = rej; });
    const e: Internal = { id: frame.id, frame, bytes, promise, firstConn: null, lastSentAt: null, resends: 0, stuck: false, resolve, reject };
    this.m.set(frame.id, e); this.total += bytes; return { entry: e, fresh: true };
  }
  markSent(id: string, conn: number, now: number): void { const e = this.m.get(id); if (!e) return; if (e.firstConn === null) e.firstConn = conn; e.lastSentAt = now; }

  /** The echo arrived: resolve with its seq and forget the frame. False if the id is not ours. */
  echo(id: string, seq: number): boolean { const e = this.m.get(id); if (!e) return false; this.remove(e); e.resolve({ id, seq }); return true; }
  /** Give up on a frame that can never be sent (too large, not allowed by the schema). */
  fail(id: string, err: unknown): void { const e = this.m.get(id); if (!e) return; this.remove(e); e.reject(err); }

  /** A new welcome: every frame gets a fresh round of resends. */
  onWelcome(): void { for (const e of this.m.values()) { e.resends = 0; e.stuck = false; } }
  /** Frames to resend now, and frames that just used up their resends. */
  due(now: number, resendAfterMs = RESEND_AFTER_MS, maxResends = MAX_RESENDS): { resend: OutboxEntry[]; stuck: OutboxEntry[] } {
    const resend: OutboxEntry[] = []; const stuck: OutboxEntry[] = [];
    for (const e of this.m.values()) {
      if (e.lastSentAt === null || e.stuck || now - e.lastSentAt < resendAfterMs) continue;
      if (e.resends < maxResends) { e.resends++; resend.push(e); } else { e.stuck = true; stuck.push(e); }
    }
    return { resend, stuck };
  }
  /** When the next frame becomes due (Infinity when none). */
  nextDueAt(resendAfterMs = RESEND_AFTER_MS): number { let t = Infinity; for (const e of this.m.values()) if (e.lastSentAt !== null && !e.stuck) t = Math.min(t, e.lastSentAt + resendAfterMs); return t; }
  private remove(e: Internal): void { this.m.delete(e.id); this.total -= e.bytes; }
}
