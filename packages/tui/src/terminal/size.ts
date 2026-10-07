/** Terminal size, live: one callback per burst of resize events (50 ms), with the final size. */
export interface SizeOut { columns?: number; rows?: number; on(e: 'resize', f: () => void): unknown; off(e: 'resize', f: () => void): unknown }
export function watchSize(out: SizeOut, cb: (size: { cols: number; rows: number }) => void, clock: { setTimeout(f: () => void, ms: number): unknown; clearTimeout(h: unknown): void } = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) }, debounceMs = 50): () => void {
  let h: unknown; const onResize = () => { if (h !== undefined) clock.clearTimeout(h); h = clock.setTimeout(() => { h = undefined; cb({ cols: out.columns ?? 80, rows: out.rows ?? 24 }); }, debounceMs); };
  out.on('resize', onResize); return () => { out.off('resize', onResize); if (h !== undefined) clock.clearTimeout(h); };
}
