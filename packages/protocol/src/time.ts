/** CT-IDS time and money. Wire timestamps are RFC 3339, UTC, `Z`, millisecond precision. */
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;

export const formatRfc3339 = (ms: number): string => new Date(ms).toISOString();
export const nowRfc3339 = (clock: { now: () => number }): string => formatRfc3339(clock.now());

/** Epoch milliseconds, or undefined if the text is not a valid RFC 3339 timestamp. Offsets are honored; the wire format itself is always Z. */
export function parseRfc3339(s: string): number | undefined {
  const m = RFC3339.exec(s); if (!m) return undefined;
  const [, y, mo, d, h, mi, se, frac, tz] = m; const ms = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +se!, frac ? +frac.padEnd(3, '0') : 0);
  const back = new Date(ms); if (back.getUTCMonth() !== +mo! - 1 || back.getUTCDate() !== +d! || +h! > 23 || +mi! > 59 || +se! > 59) return undefined; // 2026-02-30 and 25:00 are not dates
  if (tz === 'Z') return ms; const off = (+tz!.slice(1, 3) * 60 + +tz!.slice(4, 6)) * 60_000; return tz![0] === '+' ? ms - off : ms + off;
}

export type Currency = 'USD' | 'EUR';
/** Integer minor units plus an ISO-4217 code. Never floats. */
export interface Money { amount: number; currency: Currency }
export function isMoney(v: unknown): v is Money { return !!v && typeof v === 'object' && Number.isInteger((v as Money).amount) && ((v as Money).currency === 'USD' || (v as Money).currency === 'EUR'); }
export const formatMoney = (m: Money, locale = 'en-US'): string => new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(m.amount / 100);
