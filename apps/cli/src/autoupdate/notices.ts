/** The toast for "a newer version exists", whether it comes from our own check, from a `sys.notice client_update_available` frame, or from a notification with the
 *  category `update_available`. A notice only SHOWS this toast: it never starts a download (the user runs `centcom update`, or the next start brings it in).
 *  The server sends ids and enums, never display text, so the words live here and every value is checked before it is shown. */
import type { Channel } from '@centcom/net';

export interface UpdateToast { level: 'info'; text: string; detail?: string }
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]{1,40})?$/; const CHANNELS: readonly string[] = ['stable', 'beta', 'nightly'];
export const updateToast = (version: string, channel?: Channel): UpdateToast => ({ level: 'info', text: `Update available: ${version}`, ...(channel ? { detail: `On the ${channel} channel. Run: centcom update` } : { detail: 'Run: centcom update' }) });

const fromParams = (params: unknown): UpdateToast | undefined => {
  if (!params || typeof params !== 'object') return undefined; const p = params as { version?: unknown; channel?: unknown };
  if (typeof p.version !== 'string' || !VERSION.test(p.version)) return undefined;
  return updateToast(p.version, typeof p.channel === 'string' && CHANNELS.includes(p.channel) ? (p.channel as Channel) : undefined);
};
/** A `sys.notice` frame body `{code, level, params}`. Any other code is none of our business. */
export function toastForNotice(body: unknown): UpdateToast | undefined {
  if (!body || typeof body !== 'object') return undefined; const b = body as { code?: unknown; params?: unknown };
  return b.code === 'client_update_available' ? fromParams(b.params) : undefined;
}
/** A notification (CT-NOTIF-PAYLOAD) of the category `update_available`. */
export function toastForNotification(n: unknown): UpdateToast | undefined {
  if (!n || typeof n !== 'object') return undefined; const o = n as { category?: unknown; params?: unknown };
  return o.category === 'update_available' ? fromParams(o.params) : undefined;
}
