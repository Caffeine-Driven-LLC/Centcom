/** After a sleep every socket is probably dead and half-open: notice a gap in the clock and reconnect them, spread out so a crowd does not return at once. */
import type { NetClock } from './net-state.js';
export interface Reconnectable { reconnect(): void }
export interface WakeOptions { clock: NetClock; targets: () => Reconnectable[]; tickMs?: number; gapMs?: number; maxJitterMs?: number; rng?: () => number; onWake?: (gapMs: number) => void }
export const WAKE_GAP_MS = 30_000;
export class WakeDetector {
  private last = 0; private timer: unknown; private running = false; private readonly rng: () => number;
  constructor(private readonly o: WakeOptions) { this.rng = o.rng ?? Math.random; }
  start(): void { if (this.running) return; this.running = true; this.last = this.o.clock.now(); this.arm(); }
  stop(): void { this.running = false; if (this.timer !== undefined) this.o.clock.clearTimeout(this.timer as never); this.timer = undefined; }
  private arm(): void { this.timer = this.o.clock.setTimeout(() => { if (!this.running) return; const now = this.o.clock.now(); const gap = now - this.last - (this.o.tickMs ?? 5000); this.last = now; if (gap > (this.o.gapMs ?? WAKE_GAP_MS)) this.wake(gap); this.arm(); }, this.o.tickMs ?? 5000); }
  private wake(gap: number): void { this.o.onWake?.(gap); for (const t of this.o.targets()) this.o.clock.setTimeout(() => { try { t.reconnect(); } catch { /* one stuck socket must not stop the others */ } }, Math.floor(this.rng() * (this.o.maxJitterMs ?? 2000))); }
}
