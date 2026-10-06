/** Time and randomness for the LAN package, always injected so tests run on a virtual clock. Nothing here reads Date.now() or Math.random() behind a caller's back. */
import { randomBytes as nodeRandomBytes } from 'node:crypto';

/** Matches the testkit VirtualClock and a thin wrapper over the real timers. `monotonic` never goes backwards (used for expiry). */
export interface LanClock { now(): number; monotonic?(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: never): void }

/** Real timers. Timers keep the process alive on purpose: a scan must not exit before it is done. */
export const systemClock: LanClock = { now: () => Date.now(), monotonic: () => performance.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h: never) => clearTimeout(h as NodeJS.Timeout) };

/** Monotonic time of a clock, falling back to `now` for clocks without one. */
export const mono = (c: LanClock): number => (c.monotonic ? c.monotonic() : c.now());

/** n random bytes from the platform CSPRNG. */
export type RandomBytes = (n: number) => Uint8Array;
export const cryptoRandom: RandomBytes = (n) => new Uint8Array(nodeRandomBytes(n));

/** Resolves after `ms` on the given clock. */
export const sleep = (c: LanClock, ms: number): Promise<void> => new Promise((r) => { c.setTimeout(r, ms); });
