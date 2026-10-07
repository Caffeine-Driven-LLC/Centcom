import { useEffect, useState } from 'react';
let manual: 'full' | 'reduced' | undefined; const fns = new Set<() => void>();
/** `/motion [full|reduced]` parity: the person's choice wins over the system setting. */
export function setMotion(m: 'full' | 'reduced' | undefined): void { manual = m; for (const f of [...fns]) f(); }
export function useReducedMotion(): boolean {
  const q = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined; const [sys, setSys] = useState(!!q?.matches); const [, tick] = useState(0);
  useEffect(() => { const on = (): void => setSys(!!q?.matches); q?.addEventListener?.('change', on); const f = (): void => tick((x) => x + 1); fns.add(f); return () => { q?.removeEventListener?.('change', on); fns.delete(f); }; }, [q]);
  return manual === 'reduced' ? true : manual === 'full' ? false : sys;
}
