/** Ack cadence (CT-WS-ENVELOPE): a standalone ack after every 64 frames processed, and at the latest 5 s after the first unacked one. Piggy-backed acks count.
 *  Must not: ack when nothing new was processed, or ack a seq that was not processed in order. */
import type { RelayClock } from '../relay/index.js';

export const ACK_EVERY = 64;
export const ACK_MAX_DELAY_MS = 5_000;

export class AckScheduler {
  private acked: number | null = null; private since = 0; private timer: unknown;
  constructor(private readonly o: { clock: RelayClock; lastSeq: () => number | null; send: (seq: number) => boolean | Promise<boolean>; every?: number; maxDelayMs?: number }) {}

  /** Highest seq acked so far (piggy-backed or standalone). */
  get lastAcked(): number | null { return this.acked; }
  /** Frames processed but not acked yet. */
  get unacked(): number { return this.since; }

  /** One frame was processed in order. */
  onDelivered(): void {
    this.since++;
    if (this.since >= (this.o.every ?? ACK_EVERY)) { void this.flush(); return; }
    if (this.timer === undefined) this.timer = this.o.clock.setTimeout(() => { this.timer = undefined; void this.flush(); }, this.o.maxDelayMs ?? ACK_MAX_DELAY_MS);
  }
  /** An outbound frame carried `ack: seq`. */
  onPiggyback(seq: number): void { if (this.acked === null || seq >= this.acked) this.acked = seq; if (seq === this.o.lastSeq()) { this.since = 0; this.clear(); } }

  /** Send a standalone ack now if anything is unacked. A failed send keeps the frames unacked and tries again after the delay. */
  async flush(): Promise<void> {
    const seq = this.o.lastSeq(); if (seq === null || this.since === 0) return;
    this.clear(); const n = this.since; this.since = 0;
    let ok = false; try { ok = await this.o.send(seq); } catch { ok = false; }
    if (ok) { if (this.acked === null || seq > this.acked) this.acked = seq; return; }
    this.since += n; if (this.timer === undefined) this.timer = this.o.clock.setTimeout(() => { this.timer = undefined; void this.flush(); }, this.o.maxDelayMs ?? ACK_MAX_DELAY_MS);
  }
  /** Forget pending work (for a reset); stop the timer. */
  stop(): void { this.clear(); }
  reset(): void { this.clear(); this.since = 0; this.acked = null; }
  private clear(): void { if (this.timer !== undefined) this.o.clock.clearTimeout(this.timer as never); this.timer = undefined; }
}
