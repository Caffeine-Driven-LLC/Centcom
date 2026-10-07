import { useEffect, useState } from 'react';
/** The time, refreshed every second, for the lock countdowns: pass it as `now` to `LockChip` and `LockInspector`. Stops with the component. */
export function useNow(o: { everyMs?: number; now?: () => number } = {}): number {
  const read = o.now ?? Date.now; const [t, setT] = useState(read);
  useEffect(() => { const h = setInterval(() => setT(read()), o.everyMs ?? 1000); return () => clearInterval(h); }, [o.everyMs]);
  return t;
}
