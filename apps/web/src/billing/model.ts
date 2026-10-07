import { fmt } from '../i18n/index.js';
export interface Limits { [k: string]: number | boolean | null | undefined }
export interface Subscription { plan: string; status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'none' | string; seats: number; currency?: string; interval?: string; current_period_end: string; cancel_at_period_end?: boolean; trial_end?: string | null; grace_until?: string | null }
export interface Entitlements { rev: number; plan: string; status: string; limits: Limits; usage?: Record<string, number>; warnings?: { limit: string; pct: number }[]; grace_until?: string | null }
export interface Money { amount: number; currency: string }
export const money = (m: Money): string => fmt.money(m.amount, m.currency);
/** `null` is unlimited, 0 is none, a number is a number; a switch shows as on or off. */
export function limitText(v: number | boolean | null | undefined): string { if (v === null) return 'Unlimited'; if (v === undefined) return '—'; if (typeof v === 'boolean') return v ? 'On' : 'Off'; return v === 0 ? 'None' : fmt.number(v); }
export const LIMIT_LABELS: Record<string, string> = { max_seats: 'Seats', max_session_members: 'People in a session', max_concurrent_sessions: 'Sessions at once', max_parallel_agents: 'Agents at once', history_days: 'History (days)', queue_items_month: 'Queue items a month', audit_log_days: 'Audit log (days)', webhooks_max: 'Webhooks', api_keys_max: 'API keys', hosted_minutes_month: 'Hosted minutes a month', relay_access: 'Hosted sessions', lan_multiplayer: 'LAN multiplayer' };
/** Which usage figure belongs to which limit. */
export const USAGE_OF: Record<string, string> = { max_seats: 'seats', queue_items_month: 'queue_items_month', hosted_minutes_month: 'hosted_minutes_month' };
export type Level = 'ok' | 'warn' | 'firm';
export interface MeterView { key: string; label: string; used: number; limit: number | null; limitText: string; pct: number | undefined; level: Level; pips?: string }
/** Pixel pips for small counts: `■■■□□`, at most 10 squares. */
export function pips(used: number, limit: number): string { const n = Math.min(10, Math.max(1, limit)); const on = limit <= 10 ? Math.min(used, n) : Math.min(n, Math.round((used / limit) * n)); return '■'.repeat(on) + '□'.repeat(n - on); }
export function meters(e: Entitlements): MeterView[] {
  const out: MeterView[] = []; for (const [k, u] of Object.entries(USAGE_OF)) { const limit = e.limits[k]; if (limit === undefined || typeof limit === 'boolean') continue; const used = e.usage?.[u] ?? 0; const lim = limit as number | null; const pct = lim === null || lim === 0 ? undefined : Math.floor((used / lim) * 100); const warned = (e.warnings ?? []).some((w) => w.limit === k && w.pct >= 80);
    const level: Level = lim !== null && lim > 0 && used >= lim ? 'firm' : lim === 0 && used > 0 ? 'firm' : warned || (pct !== undefined && pct >= 80) ? 'warn' : 'ok'; out.push({ key: k, label: LIMIT_LABELS[k] ?? k, used, limit: lim, limitText: limitText(lim), pct, level, ...(k === 'max_seats' && lim !== null ? { pips: pips(used, lim) } : {}) }); }
  return out;
}
/** Limits that are shown and nothing else: unknown keys are read-only text and never open anything. */
export const limitRows = (e: Entitlements): { key: string; label: string; text: string }[] => Object.entries(e.limits).map(([key, v]) => ({ key, label: LIMIT_LABELS[key] ?? key, text: limitText(v as never) }));
export interface BannerView { id: string; tone: 'warning' | 'danger' | 'info'; title: string; text: string; action?: 'portal' | 'plans' }
/** At most 2 banners: the firm ones first, then the 80 % ones; they stay until the numbers change. */
export function banners(e: Entitlements, sub: Subscription | undefined, now: number): BannerView[] {
  const out: BannerView[] = []; const st = statusView(sub, now); if (st.banner) out.push(st.banner);
  for (const m of meters(e).filter((x) => x.level === 'firm')) out.push({ id: `firm:${m.key}`, tone: 'danger', title: `! ${m.label} limit reached`, text: `You have used all of your ${m.label.toLowerCase()}. Upgrade to add more.`, action: 'plans' });
  for (const m of meters(e).filter((x) => x.level === 'warn')) out.push({ id: `warn:${m.key}`, tone: 'warning', title: `! ${m.label}: ${m.pct ?? 80}% used`, text: `You have used ${m.pct ?? 80}% of your ${m.label.toLowerCase()}.`, action: 'plans' });
  return out.slice(0, 2);
}
export interface StatusView { label: string; paid: boolean; banner?: BannerView; /** after the grace period a past-due workspace behaves like the free plan */ freeBehaviour: boolean }
export function statusView(sub: Subscription | undefined, now: number): StatusView {
  if (!sub || sub.status === 'none') return { label: 'Free', paid: false, freeBehaviour: true };
  const end = Date.parse(sub.current_period_end); const date = (iso: string): string => fmt.date(Date.parse(iso), { dateStyle: 'medium', timeZone: 'UTC' });
  switch (sub.status) {
    case 'active': return { label: 'Active', paid: true, freeBehaviour: false };
    case 'trialing': return { label: 'Trial', paid: true, freeBehaviour: false, banner: sub.trial_end ? { id: 'trial', tone: 'info', title: 'Trial', text: `Your trial ends on ${date(sub.trial_end)}.` } : undefined };
    case 'past_due': { const g = sub.grace_until ? Date.parse(sub.grace_until) : NaN; const left = g - now; if (Number.isFinite(g) && left <= 0) return { label: 'Payment overdue', paid: false, freeBehaviour: true, banner: { id: 'past_due', tone: 'danger', title: '! Payment overdue', text: 'The grace period is over, so your workspace is back on the free plan until the payment goes through.', action: 'portal' } };
      const days = Math.floor(left / 86_400_000); const hours = Math.floor((left % 86_400_000) / 3_600_000); return { label: 'Payment overdue', paid: true, freeBehaviour: false, banner: { id: 'past_due', tone: 'danger', title: '! Payment failed', text: Number.isFinite(g) ? `Update your payment method within ${days > 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : `${hours} ${hours === 1 ? 'hour' : 'hours'}`} to keep your plan.` : 'Update your payment method to keep your plan.', action: 'portal' } }; }
    case 'canceled': return { label: 'Canceled', paid: Number.isFinite(end) && end > now, freeBehaviour: !(Number.isFinite(end) && end > now), banner: { id: 'canceled', tone: 'info', title: 'Canceled', text: Number.isFinite(end) && end > now ? `Your plan stays until ${date(sub.current_period_end)}, then the workspace moves to the free plan.` : 'Your plan has ended and the workspace is on the free plan.', action: 'plans' } };
    default: return { label: String(sub.status), paid: false, freeBehaviour: true };
  }
}
export const PLAN_BADGE: Record<string, string> = { free: 'FREE', pro: 'PRO', team: 'TEAM' };
export const planBadge = (plan: string | undefined): string => PLAN_BADGE[plan ?? 'free'] ?? String(plan ?? 'free').toUpperCase().slice(0, 8);
