/** A waiver lets a contract without fixtures pass `--strict` for a while: at most 60 days, with an issue to track it. An expired one is ignored. */
import type { Waiver } from './types.js';
export const MAX_WAIVER_DAYS = 60; const DAY = 86_400_000;
const date = (s: string): number | undefined => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T23:59:59.999Z`) : undefined);
export function validateWaivers(ws: unknown, now: number): { valid: Waiver[]; problems: string[] } {
  const problems: string[] = []; const valid: Waiver[] = []; if (!Array.isArray(ws)) return { valid, problems: ['waivers.json must be a list'] };
  for (const w of ws as Partial<Waiver>[]) {
    const id = String(w?.contract ?? '?'); if (!w || typeof w.contract !== 'string' || !/^CT-[A-Z0-9-]+$/.test(w.contract)) { problems.push(`${id}: contract missing or malformed`); continue; }
    if (!w.reason || !w.issue) { problems.push(`${id}: needs a reason and an issue`); continue; } const e = date(String(w.expires)); if (e === undefined) { problems.push(`${id}: expires must be YYYY-MM-DD`); continue; }
    if (e - now > MAX_WAIVER_DAYS * DAY) { problems.push(`${id}: expires more than ${MAX_WAIVER_DAYS} days from now`); continue; }
    if (e < now) continue; valid.push(w as Waiver);
  }
  return { valid, problems };
}
