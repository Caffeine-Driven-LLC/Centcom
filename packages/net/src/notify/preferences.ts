/** Notification preferences: what the service stores (channels x categories, quiet hours) plus the `os` switches that live only on this computer. */
import type { HttpClient } from '../http/types.js';
import type { Category } from './messages.js';

export interface ChannelSwitches { inbox?: boolean; push?: boolean; email?: boolean; os?: boolean }
export interface QuietHours { enabled: boolean; start: string; end: string; timezone: string; allow_approval_needed?: boolean }
export interface NotificationPreferences { channels: Partial<Record<Category, ChannelSwitches>>; quiet_hours: QuietHours }
export interface PreferencesResult { preferences: NotificationPreferences; etag?: string }

export async function getPreferences(http: HttpClient): Promise<PreferencesResult> {
  const r = await http.call('getNotificationPreferences', {} as never); return { preferences: r.data as unknown as NotificationPreferences, etag: r.etag };
}
/** Replaces the preferences. Pass the ETag from the read so a change made elsewhere is not overwritten (the service answers 412 and the caller re-reads). */
export async function setPreferences(http: HttpClient, p: NotificationPreferences, o: { etag?: string } = {}): Promise<PreferencesResult> {
  const r = await http.call('replaceNotificationPreferences', { body: p } as never, o.etag ? { ifMatch: o.etag } : undefined); return { preferences: r.data as unknown as NotificationPreferences, etag: r.etag };
}

/** The `os` channel is client-local: the service ignores it, so it is kept in a small config object and merged in here. */
export type LocalOs = Partial<Record<Category, boolean>>;
export const osEnabled = (cat: string, local: LocalOs, remote?: NotificationPreferences): boolean => (cat in local ? !!local[cat as Category] : !!remote?.channels?.[cat as Category]?.os);

/** Is `now` inside the quiet window (in the user's time zone)? A window that crosses midnight (22:00-07:00) is handled. */
export function inQuietHours(q: QuietHours | undefined, now: number): boolean {
  if (!q?.enabled) return false; const m = (s: string) => { const [h, mi] = s.split(':').map(Number); return h! * 60 + mi!; };
  let parts: Intl.DateTimeFormatPart[]; try { parts = new Intl.DateTimeFormat('en-GB', { timeZone: q.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)); } catch { parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)); }
  const cur = Number(parts.find((p) => p.type === 'hour')!.value) * 60 + Number(parts.find((p) => p.type === 'minute')!.value); const a = m(q.start); const b = m(q.end);
  if (a === b) return false; return a < b ? cur >= a && cur < b : cur >= a || cur < b;
}
/** Should this notification show on the OS? Quiet hours hide `os` and `push`, except security alerts and billing problems, and a high-priority approval request only when the user opted in. */
export function allowedByQuietHours(n: { category: string; priority: string }, q: QuietHours | undefined, now: number): boolean {
  if (!inQuietHours(q, now)) return true; if (n.category === 'security_alert' || n.category === 'billing_issue') return true;
  return n.category === 'approval_needed' && n.priority === 'high' && q?.allow_approval_needed === true;
}
