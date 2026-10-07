/** A waiver needs an issue URL and an expiry within 90 days; an expired or malformed one makes its check fail. */
import type { CheckResult, Waiver } from './types.js';
export const MAX_WAIVER_DAYS = 90; const DAY = 86_400_000;
export function validateWaivers(ws: unknown, now: number): { valid: Waiver[]; problems: string[] } {
  const valid: Waiver[] = []; const problems: string[] = []; if (!Array.isArray(ws)) return { valid, problems: ['waivers.json must be a list'] };
  for (const w of ws as Partial<Waiver>[]) {
    const id = String(w?.id ?? '?'); if (!w || typeof w.id !== 'string' || !w.id) { problems.push(`${id}: needs an id`); continue; }
    if (typeof w.issue !== 'string' || !/^https:\/\/[^\s]+$/.test(w.issue)) { problems.push(`${id}: needs an issue URL`); continue; }
    const t = typeof w.expires === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.expires) ? Date.parse(`${w.expires}T23:59:59.999Z`) : NaN; if (!Number.isFinite(t)) { problems.push(`${id}: expires must be YYYY-MM-DD`); continue; }
    if (t - now > MAX_WAIVER_DAYS * DAY) { problems.push(`${id}: expires more than ${MAX_WAIVER_DAYS} days from now`); continue; }
    if (t < now) { problems.push(`${id}: the waiver expired on ${w.expires}`); continue; }
    valid.push(w as Waiver);
  }
  return { valid, problems };
}
/** A failing check with a live waiver becomes `waived`; its findings are kept so they stay visible. */
export function applyWaivers(checks: CheckResult[], waivers: Waiver[]): CheckResult[] { return checks.map((c) => (c.status === 'fail' && waivers.some((w) => w.id === c.id) ? { ...c, status: 'waived' as const } : c)); }
