/** When to look for an update on start-up: at most once a day, never when switched off, never waiting for the answer. */
export const CHECK_EVERY_MS = 24 * 3_600_000; export const BACKGROUND_TIMEOUT_MS = 5000;
export interface CheckState { at: number; etag?: string; version?: string }
export function shouldCheck(o: { now: number; last?: CheckState; env: Record<string, string | undefined>; configCheck?: boolean }): boolean {
  if (o.configCheck === false) return false; if (o.env.CENTCOM_NO_UPDATE_CHECK === '1' || /^true$/i.test(o.env.CENTCOM_NO_UPDATE_CHECK ?? '')) return false; if (o.env.CI) return false;
  return !o.last || !Number.isFinite(o.last.at) || o.now - o.last.at >= CHECK_EVERY_MS || o.last.at > o.now;
}
/** Runs the check in the background with a 5 s limit; calls `onAvailable` only when there is something newer. Never throws. */
export async function backgroundCheck(o: { check(signal: AbortSignal): Promise<{ available: boolean; version?: string }>; save(s: CheckState): Promise<void>; now: () => number; onAvailable: (v: string) => void }): Promise<void> {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), BACKGROUND_TIMEOUT_MS);
  try { const r = await o.check(ac.signal); await o.save({ at: o.now(), version: r.version }); if (r.available && r.version) o.onAvailable(r.version); } catch { /* offline or slow: try again tomorrow */ } finally { clearTimeout(t); }
}
