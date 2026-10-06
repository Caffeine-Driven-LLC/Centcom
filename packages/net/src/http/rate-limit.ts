/** RateLimit-* response headers (CT-PAGE "Rate limits", IETF RateLimit draft). Parsing only; nothing here waits or throttles. */

export interface RateLimitInfo { limit: number; remaining: number; resetS: number }
interface HeaderBag { get(name: string): string | null }

const int = (v: string | null): number | undefined => { if (v === null) return undefined; const t = v.trim(); return /^\d{1,10}$/.test(t) ? Number(t) : undefined; };

/** All three headers present and well formed, or undefined. */
export function parseRateLimit(h: HeaderBag): RateLimitInfo | undefined {
  const limit = int(h.get('ratelimit-limit')); const remaining = int(h.get('ratelimit-remaining')); const resetS = int(h.get('ratelimit-reset'));
  return limit === undefined || remaining === undefined || resetS === undefined ? undefined : { limit, remaining, resetS };
}
