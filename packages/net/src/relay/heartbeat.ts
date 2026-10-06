/** Heartbeat (CT-WS-ENVELOPE "Heartbeat"): the pong for a ping, and the dead-connection detector.
 *  Must not: send anything itself or decide about reconnecting; the client does both. */
import type { Frame } from '@centcom/protocol';

export const DEFAULT_PING_MS = 20_000;
export const DEFAULT_DEAD_MS = 50_000;
/** A welcome's dead_ms outside this range is ignored (default used): too short would flap, too long would hide a dead link. */
export const MIN_DEAD_MS = 5_000;
export const MAX_DEAD_MS = 600_000;

/** Timers the relay and delivery code use. `@centcom/testkit`'s VirtualClock fits. */
export interface RelayClock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: never): void }

/** The sys.pong for a sys.ping: the same `p.t`, nothing else. */
export function pongFor(ping: Frame): Frame { return { v: 1, t: 'sys.pong', p: ping.p && 't' in ping.p ? { t: ping.p.t } : {} }; }

/** dead_ms from welcome.heartbeat, or the default when it is missing or out of range. */
export function deadMsFrom(heartbeat: unknown): number {
  const d = (heartbeat as { dead_ms?: unknown } | null | undefined)?.dead_ms;
  return typeof d === 'number' && Number.isInteger(d) && d >= MIN_DEAD_MS && d <= MAX_DEAD_MS ? d : DEFAULT_DEAD_MS;
}

/** Calls `onDead` once when nothing has arrived for `deadMs`. One timer at a time: it is re-armed for the remainder when activity came in meanwhile. */
export class DeadDetector {
  private last = 0; private timer: unknown; private running = false;
  constructor(private readonly clock: RelayClock, private readonly deadMs: number, private readonly onDead: () => void) {}
  start(): void { this.running = true; this.last = this.clock.now(); this.arm(this.deadMs); }
  /** Any inbound frame (valid or not) counts as activity. */
  touch(): void { this.last = this.clock.now(); }
  stop(): void { this.running = false; if (this.timer !== undefined) this.clock.clearTimeout(this.timer as never); this.timer = undefined; }
  private arm(ms: number): void {
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined; if (!this.running) return;
      const idle = this.clock.now() - this.last;
      if (idle >= this.deadMs) { this.running = false; this.onDead(); } else this.arm(this.deadMs - idle);
    }, ms);
  }
}
