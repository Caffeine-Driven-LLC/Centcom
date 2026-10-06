/** Feature gates over one entitlements object (CT-ENTITLEMENTS §2, §4, §5). Pure functions; the client in entitlements.ts feeds them.
 *  Gates are advisory: the server enforces at the moment of the action, so a stale `true` here never bypasses it.
 *  Must not: unlock anything from an unknown key, gate LAN or local use, or look at prices, Stripe or card state. */
import type { Entitlements } from '@centcom/protocol';

/** The keys CT-ENTITLEMENTS §2 defines. Anything else is an unknown key: shown generically, never used to unlock a feature. */
export const KNOWN_LIMIT_KEYS = ['relay_access', 'lan_multiplayer', 'max_seats', 'max_session_members', 'max_concurrent_sessions', 'max_parallel_agents', 'history_days', 'hosted_minutes_month', 'queue_items_month', 'audit_log_days', 'webhooks_max', 'api_keys_max'] as const;
export type KnownLimitKey = (typeof KNOWN_LIMIT_KEYS)[number];
/** Monthly meters the server measures; `remaining()` works on these only. */
export type MeteredKey = 'hosted_minutes_month' | 'queue_items_month';
const KNOWN = new Set<string>(KNOWN_LIMIT_KEYS);
const BOOLEAN_KEYS = new Set<string>(['relay_access', 'lan_multiplayer']);

/** Free-plan reference values (CT-ENTITLEMENTS §3), used for status `none`, after a grace or paid period ends, and when nothing is known.
 *  For display and advisory gates only: the server holds the real values. */
export const FREE_DEFAULT_LIMITS: Entitlements['limits'] = {
  relay_access: false, lan_multiplayer: true, max_seats: 1, max_session_members: 8, max_concurrent_sessions: 0, max_parallel_agents: 4,
  history_days: 0, hosted_minutes_month: 0, queue_items_month: null, audit_log_days: 0, webhooks_max: 0, api_keys_max: 1,
};

/** What a client shows when it knows nothing: status `none` with free limits. `workspace` is '' when there is no workspace. */
export function defaultEntitlements(workspace = ''): Entitlements {
  return { workspace, rev: 0, plan: 'free', status: 'none', limits: { ...FREE_DEFAULT_LIMITS }, usage: {}, warnings: [], grace_until: null };
}

const ms = (iso: unknown): number | undefined => { if (typeof iso !== 'string') return undefined; const t = Date.parse(iso); return Number.isFinite(t) ? t : undefined; };

/** True when the status rules say this object now counts as `none` (CT-ENTITLEMENTS §4): past_due after `grace_until`, canceled after `period.end`.
 *  Without the date the object is kept as it is (the server decides). */
export function expired(ent: Entitlements, now: number): boolean {
  if (ent.status === 'none') return true;
  if (ent.status === 'past_due') { const g = ms(ent.grace_until); return g !== undefined && now >= g; }
  if (ent.status === 'canceled') { const e = ms(ent.period?.end); return e !== undefined && now >= e; }
  return false;
}

/** The limits that apply now: the object's own, or the free defaults once its status has run out. */
export function effectiveLimits(ent: Entitlements | null | undefined, now: number): Entitlements['limits'] {
  if (!ent || expired(ent, now)) return { ...FREE_DEFAULT_LIMITS };
  return ent.limits;
}

/** May the feature behind `key` be offered? `lan_multiplayer` is always true and never looked up; an unknown key is 'unknown', never true.
 *  For a count, 0 means none and null means unlimited. */
export function can(ent: Entitlements | null | undefined, key: string, now: number): boolean | 'unknown' {
  if (key === 'lan_multiplayer') return true;
  if (!KNOWN.has(key)) return 'unknown';
  const v = effectiveLimits(ent, now)[key];
  if (BOOLEAN_KEYS.has(key)) return v === true;
  return v === null || (typeof v === 'number' && v > 0);
}

/** The raw value for display: a number, a boolean, null (unlimited) or undefined (not present). Unknown keys are returned too, for display only. */
export function limit(ent: Entitlements | null | undefined, key: string, now: number): number | boolean | null | undefined {
  if (key === 'lan_multiplayer') return true;
  const v = effectiveLimits(ent, now)[key];
  return typeof v === 'number' || typeof v === 'boolean' || v === null ? v : undefined;
}

/** What is left of a monthly meter: `limit - usage` (never below 0), or null when the limit is unlimited or unknown. */
export function remaining(ent: Entitlements | null | undefined, key: MeteredKey, now: number): number | null {
  const lim = effectiveLimits(ent, now)[key];
  if (typeof lim !== 'number') return null;
  const used = ent && !expired(ent, now) ? ent.usage?.[key] : undefined;
  return Math.max(0, lim - (typeof used === 'number' && used > 0 ? used : 0));
}

export type BannerKind = 'none' | 'past_due' | 'canceled' | 'quota_warning' | 'quota_reached';
export interface Banner { kind: BannerKind; pct?: number; graceUntil?: string; periodEnd?: string }
/** A quota notice from the session (sys.notice usage_warning / quota_reached) that is still in force. */
export interface QuotaNotice { level: 'warning' | 'reached'; pct?: number }

/** The one banner to show, most urgent first: past_due, canceled, quota reached, quota warning, else none. */
export function banner(ent: Entitlements | null | undefined, now: number, notice?: QuotaNotice): Banner {
  if (ent?.status === 'past_due') return { kind: 'past_due', ...(typeof ent.grace_until === 'string' ? { graceUntil: ent.grace_until } : {}) };
  if (ent?.status === 'canceled') return { kind: 'canceled', ...(typeof ent.period?.end === 'string' ? { periodEnd: ent.period.end } : {}) };
  const pcts = (ent && !expired(ent, now) ? ent.warnings ?? [] : []).map((w) => w.pct).filter((p): p is number => typeof p === 'number');
  const top = Math.max(0, ...pcts, notice?.pct ?? 0);
  if (notice?.level === 'reached' || top >= 100) return { kind: 'quota_reached', pct: 100 };
  if (notice?.level === 'warning' || pcts.length) return { kind: 'quota_warning', pct: top };
  return { kind: 'none' };
}
