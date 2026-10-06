/** Seeded randomness (mulberry32). Same seed, same sequence, on every machine. */
export interface Rng { next(): number; bytes(n: number): Uint8Array; int(maxExclusive: number): number; pick<T>(xs: readonly T[]): T }
export function createRng(seed = 1): Rng {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, bytes: (n) => Uint8Array.from({ length: n }, () => Math.floor(next() * 256)), int: (m) => Math.floor(next() * m), pick: (xs) => xs[Math.floor(next() * xs.length)]! };
}
