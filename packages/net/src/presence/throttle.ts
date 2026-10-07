/** Rate shaping for presence: at most `perSecond` sends, always the latest value, never a queue. */
export interface Clock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: never): void }
/** Calls `send(value)` at once if the minimum gap has passed, otherwise once more at the end of the gap with the latest value. Nothing is stored beyond that one value. */
export class LatestWins<T> {
  private last = -Infinity; private pending: { v: T } | undefined; private timer: unknown;
  constructor(private readonly clock: Clock, private readonly gapMs: number, private readonly send: (v: T) => void) {}
  push(v: T): void {
    const wait = this.last + this.gapMs - this.clock.now(); if (wait <= 0 && this.timer === undefined) { this.last = this.clock.now(); this.send(v); return; }
    this.pending = { v }; if (this.timer === undefined) this.timer = this.clock.setTimeout(() => { this.timer = undefined; const p = this.pending; this.pending = undefined; if (p) { this.last = this.clock.now(); this.send(p.v); } }, Math.max(0, wait));
  }
  cancel(): void { if (this.timer !== undefined) this.clock.clearTimeout(this.timer as never); this.timer = undefined; this.pending = undefined; }
}
