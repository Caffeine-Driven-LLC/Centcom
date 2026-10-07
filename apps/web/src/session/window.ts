/** Which rows to put in the page: only those near the viewport, never more than 200 (plus a little overscan), so a 5 000-frame session stays smooth. Heights are measured when known and estimated otherwise. */
export const MAX_ROWS = 200; export const OVERSCAN = 6;
export interface Range { start: number; end: number; top: number; bottom: number }
export function windowRange(heights: readonly number[], scrollTop: number, viewport: number, o: { max?: number; overscan?: number } = {}): Range {
  const n = heights.length; const max = o.max ?? MAX_ROWS; const over = o.overscan ?? OVERSCAN; if (n === 0) return { start: 0, end: 0, top: 0, bottom: 0 };
  let y = 0; let first = 0; for (; first < n; first++) { if (y + heights[first]! > scrollTop) break; y += heights[first]!; } first = Math.min(first, n - 1);
  let start = Math.max(0, first - over); let end = first; let h = 0; while (end < n && h < viewport + over * 40) h += heights[end++]!; end = Math.min(n, end + over);
  if (end - start > max) { if (first - start > max / 2) start = end - max; else end = start + max; }
  let top = 0; for (let i = 0; i < start; i++) top += heights[i]!; let bottom = 0; for (let i = end; i < n; i++) bottom += heights[i]!; return { start, end, top, bottom };
}
/** A first guess for a row's height before it has been measured. */
export const estimate = (kind: string, textLength: number): number => (kind === 'assistant' || kind === 'user' ? 40 + Math.ceil(textLength / 80) * 20 : kind === 'approval' ? 110 : kind === 'tool_request' || kind === 'tool_result' ? 64 : 32);
/** Updates at most once in `ms`: the last value always arrives. */
export function throttled<T>(fn: (v: T) => void, ms: number, c: { now(): number; setTimeout(f: () => void, ms: number): unknown; clearTimeout(h: unknown): void }): { push(v: T): void; flush(): void; cancel(): void } {
  let last = -Infinity; let pending: { v: T } | undefined; let timer: unknown;
  const run = (): void => { timer = undefined; if (!pending) return; const v = pending.v; pending = undefined; last = c.now(); fn(v); };
  return { push(v) { pending = { v }; if (timer !== undefined) return; const wait = last + ms - c.now(); if (wait <= 0) run(); else timer = c.setTimeout(run, wait); }, flush() { if (timer !== undefined) c.clearTimeout(timer); run(); }, cancel() { if (timer !== undefined) c.clearTimeout(timer); timer = undefined; pending = undefined; } };
}
