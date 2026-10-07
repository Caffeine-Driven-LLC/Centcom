import { WEBHOOK_EVENTS, isWebhookEvent } from './events.js';
export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
/** https only; plain http only for localhost with an explicit flag. No credentials in the URL. */
export function checkUrl(raw: string | undefined, o: { allowLocalhost?: boolean } = {}): Checked<string> {
  if (!raw) return { ok: false, message: 'Give the address that should receive events with --url https://...' }; let u: URL; try { u = new URL(raw); } catch { return { ok: false, message: `"${raw.slice(0, 80)}" is not a web address.` }; }
  if (u.username || u.password) return { ok: false, message: 'The address must not contain a user name or password.' };
  if (u.protocol === 'https:') return { ok: true, value: u.href };
  if (u.protocol === 'http:' && LOCAL.has(u.hostname)) return o.allowLocalhost ? { ok: true, value: u.href } : { ok: false, message: 'Plain http is only allowed for localhost, and only with --allow-localhost.' };
  return { ok: false, message: 'The address must start with https://.' };
}
export function checkEvents(events: string[]): Checked<string[]> {
  if (events.length === 0) return { ok: false, message: `Give at least one --event. Valid types: ${WEBHOOK_EVENTS.join(', ')}` };
  const bad = events.filter((e) => !isWebhookEvent(e)); if (bad.length) return { ok: false, message: `Unknown event type${bad.length > 1 ? 's' : ''}: ${bad.join(', ')}. Valid types: ${WEBHOOK_EVENTS.join(', ')}` };
  return { ok: true, value: [...new Set(events)] };
}
export const WEBHOOK_ID = /^whk_[0-9A-HJKMNP-TV-Z]{26}$/; export const DELIVERY_ID = /^dlv_[0-9A-HJKMNP-TV-Z]{26}$/; export const WORKSPACE_ID = /^wsp_[0-9A-HJKMNP-TV-Z]{26}$/;
