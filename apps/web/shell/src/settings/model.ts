import { CATEGORIES, allowedByQuietHours, inQuietHours, lookup, parseAction, render, type Notification, type NotificationPreferences, type QuietHours } from '@centcom/notify';
export { CATEGORIES, inQuietHours, allowedByQuietHours };
export const UNKNOWN_TITLE = 'Update from Centcom';
/** Words for a notification: from the local table by key, with the parameters as plain text; an unknown key is a neutral line (and a debug log with no content). */
export function textFor(n: Notification, log?: (m: string) => void): { title: string; body: string } {
  if (lookup(String(n.title_key)) === undefined) { log?.('notification.unknown_key'); return { title: UNKNOWN_TITLE, body: render({ ...n, body_key: n.body_key }).body }; }
  const r = render(n); return { title: r.title, body: r.body };
}
/** Only a session link of the CT-DEEPLINK form becomes an in-app address; everything else is not a link at all. */
export function linkFor(n: Pick<Notification, 'action'>): string | undefined { const a = parseAction(n); return a.kind === 'open_session' ? `/s/${a.sessionId}${a.focus ? `?focus=${a.focus}` : ''}` : undefined; }
/** Channels that can never be turned off for these categories. */
export const INBOX_LOCKED: ReadonlySet<string> = new Set(['security_alert', 'billing_issue']);
export const CHANNELS = ['inbox', 'push', 'email', 'os'] as const; export type Channel = (typeof CHANNELS)[number];
export function toggleChannel(p: NotificationPreferences, cat: string, ch: Channel, on: boolean): NotificationPreferences {
  if (ch === 'inbox' && !on && INBOX_LOCKED.has(cat)) return p; return { ...p, channels: { ...p.channels, [cat]: { ...(p.channels as Record<string, Record<string, boolean>>)[cat], [ch]: on } } };
}
export const effective = (p: NotificationPreferences, cat: string, ch: Channel): boolean => (ch === 'inbox' && INBOX_LOCKED.has(cat) ? true : (p.channels as Record<string, Record<string, boolean | undefined>>)[cat]?.[ch] ?? (ch === 'inbox'));
export const QUIET_NOTE = 'Security alerts and billing problems are never held back by quiet hours.';
export function validateQuiet(q: QuietHours): string | undefined { const t = /^([01]\d|2[0-3]):[0-5]\d$/; if (!t.test(q.start) || !t.test(q.end)) return 'Use the form 22:00.'; if (q.start === q.end) return 'Start and end cannot be the same.'; return undefined; }
/** Unread count: in memory only, with rollback. */
export class Unread {
  private n = 0; private fns = new Set<() => void>(); get count(): number { return this.n; } set(n: number): void { this.n = Math.max(0, n); for (const f of [...this.fns]) f(); } subscribe(f: () => void): () => void { this.fns.add(f); return () => { this.fns.delete(f); }; }
}
export const unread = new Unread();
export const NAME_MAX = 40; const BCP47 = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;
export function validateAccount(v: { display_name?: string; locale?: string }): string | undefined { if (v.display_name !== undefined) { const n = v.display_name.trim(); if (n.length < 1 || n.length > NAME_MAX) return `Your name must be 1 to ${NAME_MAX} characters.`; } if (v.locale !== undefined && !BCP47.test(v.locale)) return 'Enter a language tag like en or de-CH.'; return undefined; }
export const TELEMETRY_TEXT = 'When on, Centcom counts which commands and screens are used and how long things take. It never includes your prompts, files, paths or names. It is off by default.';
