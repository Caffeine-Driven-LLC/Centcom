/** `fakeClock(start)`: the injectable Clock for tests. Time only moves when the test says so; timers fire in due order, ties in creation order. */
import { VirtualClock, type Clock } from '../core/clock.js';
export type { Clock };
export interface TestClock extends Clock { advance(ms: number): Promise<void>; set(ms: number): void; pending(): number }
export function fakeClock(startMs = 0, o: { vitestTimers?: { advanceTimersByTimeAsync(ms: number): Promise<unknown>; setSystemTime(ms: number): void } } = {}): TestClock {
  const c = new VirtualClock(startMs); let now = startMs;
  return {
    kind: 'virtual', now: () => c.now(), setTimeout: (f, ms) => c.setTimeout(f, ms), clearTimeout: (h) => c.clearTimeout(h), setInterval: (f, ms) => c.setInterval(f, ms), clearInterval: (h) => c.clearInterval(h), pending: () => c.pending(),
    async advance(ms: number) { await c.advance(ms); now += ms; if (o.vitestTimers) await o.vitestTimers.advanceTimersByTimeAsync(ms); },
    /** Jump forward; whatever became due fires, in order. Going back is an error. */
    set(ms: number) { if (ms < now) throw new RangeError('time cannot go backwards'); const d = ms - now; now = ms; void c.advance(d); o.vitestTimers?.setSystemTime(ms); },
  };
}
