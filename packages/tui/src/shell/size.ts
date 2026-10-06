import { useEffect, useState } from 'react';

export interface SizeSource { columns?: number; rows?: number; on(e: 'resize', f: () => void): unknown; off(e: 'resize', f: () => void): unknown }
/** The terminal size as React state; a burst of resize events gives one update (50 ms). */
export function watchSizeOf(out: SizeSource, debounceMs = 50): { cols: number; rows: number } {
  const read = () => ({ cols: out.columns ?? 80, rows: out.rows ?? 24 }); const [s, set] = useState(read);
  useEffect(() => { let h: NodeJS.Timeout | undefined; const on = () => { if (h) clearTimeout(h); h = setTimeout(() => set(read()), debounceMs); }; out.on('resize', on); return () => { out.off('resize', on); if (h) clearTimeout(h); }; }, [out, debounceMs]);
  return s;
}
