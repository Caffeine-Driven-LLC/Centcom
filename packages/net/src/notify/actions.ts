/** Reads the action a notification carries (CT-DEEPLINK). It only parses and checks; it never opens or runs anything. */
import type { Notification } from './inbox.js';
export type NotificationAction = { kind: 'open_session'; sessionId: string; focus?: 'approval' | 'queue' } | { kind: 'none' };
const SES = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/;
export function parseAction(n: Pick<Notification, 'action'>): NotificationAction {
  const a = n.action; if (!a || a.type !== 'open_session' || typeof a.deeplink !== 'string' || a.deeplink.length > 200) return { kind: 'none' };
  let u: URL; try { u = new URL(a.deeplink); } catch { return { kind: 'none' }; }
  if (u.protocol !== 'centcom:' || u.hostname !== 'session' || u.username || u.password || u.port || u.hash) return { kind: 'none' };
  const id = u.pathname.replace(/^\//, ''); if (!SES.test(id)) return { kind: 'none' };
  const keys = [...u.searchParams.keys()]; if (keys.some((k) => k !== 'focus') || keys.length > 1) return { kind: 'none' };
  const f = u.searchParams.get('focus'); if (f !== null && f !== 'approval' && f !== 'queue') return { kind: 'none' };
  return { kind: 'open_session', sessionId: id, ...(f ? { focus: f } : {}) };
}
