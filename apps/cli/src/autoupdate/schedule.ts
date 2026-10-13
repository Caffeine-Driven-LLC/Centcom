/** When to look for an update: at most every `update.check_interval_h` hours (default 6) give or take 20 %, so a fleet of installs does not call in step.
 *  The time of the last look is kept in a small file. Must not: wait for the network (see startup.ts). */
import type { FsPort } from './ports.js';

export const DEFAULT_INTERVAL_H = 6; export const JITTER = 0.2;
export interface CheckCache { at: number; channel?: string; version?: string }

/** The interval in ms with up to 20 % jitter either way; `rng` is a number in [0, 1). */
export const intervalMs = (hours: number, rng: () => number): number => { const h = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_INTERVAL_H; return h * 3_600_000 * (1 + (Math.min(Math.max(rng(), 0), 1) * 2 - 1) * JITTER); };
/** Never checked, or an unreadable or future time (the clock moved), or the interval has passed. */
export function shouldCheck(now: number, lastCheck: number | null, rng: () => number, intervalH: number = DEFAULT_INTERVAL_H): boolean {
  if (lastCheck === null || !Number.isFinite(lastCheck) || lastCheck > now) return true;
  return now - lastCheck >= intervalMs(intervalH, rng);
}
export async function readCheckCache(fs: FsPort, path: string): Promise<CheckCache | null> {
  try { const j = JSON.parse(await fs.readFile(path)) as unknown; if (j && typeof j === 'object' && Number.isFinite((j as CheckCache).at)) { const c = j as CheckCache; return { at: c.at, ...(typeof c.channel === 'string' ? { channel: c.channel } : {}), ...(typeof c.version === 'string' ? { version: c.version } : {}) }; } } catch { /* missing or damaged: check again */ }
  return null;
}
export async function writeCheckCache(fs: FsPort, path: string, c: CheckCache): Promise<void> { try { await fs.writeFile(path, JSON.stringify(c)); } catch { /* a read-only home only means the next start checks again */ } }
