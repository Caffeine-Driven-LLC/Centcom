/** Seeded randomness for tests: xoshiro128**, values in [0, 1), and a CT-IDS generator whose output depends only on the seed. */
import { newIdGenerator, type Id, type IdPrefix } from '@centcom/protocol';
export function seededRng(seed: number): () => number {
  // splitmix32 turns the seed into four state words
  let a = seed >>> 0; const sm = () => { a = (a + 0x9e3779b9) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 16), 0x21f0aaad); t = Math.imul(t ^ (t >>> 15), 0x735a2d97); return (t ^ (t >>> 15)) >>> 0; };
  let s0 = sm(), s1 = sm(), s2 = sm(), s3 = sm(); const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
  return () => { const r = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0; const t = (s1 << 9) >>> 0; s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = rotl(s3, 11); s0 >>>= 0; s1 >>>= 0; s2 >>>= 0; s3 >>>= 0; return r / 4294967296; };
}
export interface IdGenerator { next<P extends IdPrefix>(prefix: P): Id<P> }
export function fixedIds(seed: number, startMs = Date.UTC(2026, 9, 5, 18, 0, 0)): IdGenerator {
  const r = seededRng(seed); let t = startMs; return newIdGenerator({ now: () => (t += 1), random: (n) => Uint8Array.from({ length: n }, () => Math.floor(r() * 256)) });
}
