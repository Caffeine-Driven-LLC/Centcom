/** Notices (`sys.notice`) are shown from this table only: the server sends a code and numbers, never display text. */
import type { ToastInput } from './controller.js';

export interface NoticeIn { code: string; level: 'info' | 'warn' | 'error'; params: Record<string, unknown> }
export interface NoticeCtx { now: Date; locale: string; log?: { debug(m: string, f?: Record<string, unknown>): void } }

/** Anything interpolated is cut to a plain, short, single-line string. */
export const clean = (v: unknown, max = 40): string => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '').trim().slice(0, max);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);
/** An ISO time as local date and time, in the person's locale; empty when it is not a time. */
export function localTime(v: unknown, ctx: NoticeCtx): string {
  const t = typeof v === 'string' ? Date.parse(v) : NaN; if (!Number.isFinite(t)) return '';
  try { return new Date(t).toLocaleString(ctx.locale, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return new Date(t).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }); }
}
const upgrade = [{ key: 'u', label: 'upgrade', id: 'billing.upgrade' }]; const update = [{ key: 'u', label: 'update', id: 'update.show' }];

type Make = (p: Record<string, unknown>, c: NoticeCtx) => ToastInput;
export const NOTICES: Record<string, Make> = {
  usage_warning: (p) => ({ level: 'warn', key: 'notice:usage_warning', text: `Usage is at ${num(p.pct) ?? '?'}% of this month's quota. Agents pause at 100%.` }),
  quota_reached: (p, c) => { const r = localTime(p.resets_at, c); return { level: 'error', key: 'notice:quota_reached', text: `Monthly quota reached. Agents are paused${r ? ` until ${r}` : ''}.`, actions: upgrade }; },
  plan_changed: (p) => ({ level: 'info', key: 'notice:plan_changed', text: p.plan ? `Your plan is now ${clean(p.plan)}.` : 'Your plan changed.' }),
  member_limit_near: (p) => ({ level: 'warn', key: 'notice:member_limit_near', text: num(p.members) !== undefined && num(p.limit) !== undefined ? `This workspace has ${num(p.members)} of ${num(p.limit)} members.` : 'This workspace is close to its member limit.', actions: upgrade }),
  maintenance_soon: (p) => ({ level: 'warn', key: 'notice:maintenance_soon', text: num(p.minutes) !== undefined ? `Maintenance starts in ${num(p.minutes)} min. Sessions may reconnect.` : 'Maintenance starts soon. Sessions may reconnect.' }),
  client_update_available: (p) => ({ level: 'info', key: 'notice:client_update_available', text: p.version ? `Centcom ${clean(p.version, 20)} is available.` : 'A Centcom update is available.', actions: update }),
  history_retention_changed: (p) => ({ level: 'info', key: 'notice:history_retention_changed', text: num(p.days) !== undefined ? `Session history is now kept for ${num(p.days)} days.` : 'How long session history is kept has changed.' }),
};
const GENERIC: ToastInput = { level: 'info', text: 'Notice received.' };

export function noticeToToast(p: NoticeIn, ctx: NoticeCtx): ToastInput {
  const make = Object.prototype.hasOwnProperty.call(NOTICES, p.code) ? NOTICES[p.code] : undefined;
  if (!make) { ctx.log?.debug('toast.unknown_notice'); return GENERIC; }
  try { const t = make(p.params ?? {}, ctx); return { ...t, level: p.level === 'error' ? 'error' : t.level }; } catch { return GENERIC; }
}
