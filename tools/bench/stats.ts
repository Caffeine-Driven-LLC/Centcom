/** Small statistics for benchmark samples. */
export function percentile(sorted: number[], p: number): number { if (!sorted.length) return NaN; const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)); return sorted[i]!; }
export interface Summary { n: number; p50: number; p95: number; max: number; mean: number; cv: number }
export function summarize(samples: number[]): Summary {
  const s = [...samples].sort((a, b) => a - b); const n = s.length; const mean = n ? s.reduce((a, b) => a + b, 0) / n : NaN;
  /* noise is judged on the middle 80%: one garbage collection should not make a steady metric look unsteady */
  const mid = n >= 10 ? s.slice(Math.floor(n * 0.1), Math.ceil(n * 0.9)) : s; const m = mid.length ? mid.reduce((a, b) => a + b, 0) / mid.length : NaN; const sd = mid.length > 1 ? Math.sqrt(mid.reduce((a, b) => a + (b - m) ** 2, 0) / (mid.length - 1)) : 0;
  return { n, p50: percentile(s, 50), p95: percentile(s, 95), max: s[n - 1] ?? NaN, mean, cv: m > 0 ? sd / m : 0 };
}
/** A fixed piece of work whose time says how fast this machine is: results are scaled by the ratio to a reference machine. */
export function calibrate(rounds = 5): number {
  const times: number[] = []; for (let r = 0; r < rounds; r++) { const t0 = performance.now(); let x = 1; for (let i = 0; i < 20_000_000; i++) x = (x * 1103515245 + 12345) & 0x7fffffff; if (x === -1) console.log(x); times.push(performance.now() - t0); }
  return percentile(times.sort((a, b) => a - b), 50);
}
