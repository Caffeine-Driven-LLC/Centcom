import { useEffect, useState } from 'react';
export type Connectivity = 'unknown' | 'online' | 'degraded' | 'offline';
export interface StatusSource { getStatus(o?: { signal?: AbortSignal }): Promise<{ status?: string }> }
/** Maps what `GET /v1/status` says (or a failure to ask) to the three states the banner needs. */
export async function readConnectivity(src: StatusSource, signal?: AbortSignal): Promise<Connectivity> {
  try { const s = await src.getStatus({ signal }); return s.status === 'operational' || s.status === 'ok' ? 'online' : 'degraded'; } catch { return signal?.aborted ? 'unknown' : 'offline'; }
}
/** Polls the status endpoint (every 60 s by default); stops with the component. */
export function useConnectivity(src: StatusSource | undefined, everyMs = 60_000): Connectivity {
  const [c, setC] = useState<Connectivity>('unknown');
  useEffect(() => { if (!src) return; const ac = new AbortController(); const tick = (): void => { void readConnectivity(src, ac.signal).then((v) => { if (!ac.signal.aborted) setC(v); }); }; tick(); const h = setInterval(tick, everyMs); return () => { ac.abort(); clearInterval(h); }; }, [src, everyMs]);
  return c;
}
