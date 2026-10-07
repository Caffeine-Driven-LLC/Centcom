import { failure, Pager, type Http } from '../workspace/data.js';
import { unread } from './model.js';
import type { Notification, NotificationPreferences } from '@centcom/notify';
export type Res<T = unknown> = ({ ok: true } & T) | { ok: false; reason: string; retryAfterS?: number; message?: string };
const fail = (e: unknown): { ok: false; reason: string; retryAfterS?: number } => ({ ok: false, ...failure(e) });
export const inboxPager = (http: Http, onlyUnread = false): Pager<Notification & { id: string }> => new Pager((cursor, limit) => http.listPage('listNotifications', { limit, ...(onlyUnread ? { unread: true } : {}), ...(cursor ? { cursor } : {}) }) as never);
/** Marks one read: the badge drops at once and comes back if the server says no. */
export async function markRead(http: Http, id: string, wasUnread: boolean): Promise<Res> { if (wasUnread) unread.set(unread.count - 1); try { await http.call('markNotificationRead', { id }); return { ok: true }; } catch (e) { if (wasUnread) unread.set(unread.count + 1); return fail(e); } }
export async function markAllRead(http: Http): Promise<Res> { const before = unread.count; unread.set(0); try { await http.call('markAllNotificationsRead', {}); return { ok: true }; } catch (e) { unread.set(before); return fail(e); } }
export async function loadPreferences(http: Http): Promise<{ prefs: NotificationPreferences; etag?: string }> { const r = await http.call('getNotificationPreferences', {}); return { prefs: r.data as NotificationPreferences, etag: r.etag }; }
/** Saves with the ETag; when it is stale (412 or 409) the newest values are loaded and the person's change is laid over them, with a notice. */
export async function savePreferences(http: Http, mine: NotificationPreferences, etag: string | undefined, reapply: (theirs: NotificationPreferences) => NotificationPreferences): Promise<Res<{ prefs: NotificationPreferences; etag?: string; notice?: string }>> {
  const put = async (p: NotificationPreferences, tag?: string) => http.call('replaceNotificationPreferences', { body: p }, { ifMatch: tag });
  try { const r = await put(mine, etag); return { ok: true, prefs: r.data as NotificationPreferences, etag: r.etag }; }
  catch (e) { const s = (e as { status?: number }).status; if (s !== 412 && s !== 409) return fail(e); try { const cur = await loadPreferences(http); const merged = reapply(cur.prefs); const r = await put(merged, cur.etag); return { ok: true, prefs: r.data as NotificationPreferences, etag: r.etag, notice: 'Your settings were changed somewhere else. Yours were applied on top.' }; } catch (e2) { return fail(e2); } }
}
export async function updateAccount(http: Http, patch: { display_name?: string; locale?: string; telemetry?: boolean }): Promise<Res> { try { await http.call('updateMe', { body: patch }); return { ok: true }; } catch (e) { return fail(e); } }
export interface Device { id: string; name: string; platform?: string; created_at: string; last_seen_at?: string | null; revoked_at?: string | null; current?: boolean }
export async function listDevices(http: Http): Promise<Device[]> { const p = await http.listPage('listDevices', {}); return p.data as Device[]; }
export async function revokeDevice(http: Http, id: string): Promise<Res> { try { await http.call('revokeDevice', { id }); return { ok: true }; } catch (e) { return fail(e); } }
