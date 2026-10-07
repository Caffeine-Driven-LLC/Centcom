/** Turns a notification into words. Never throws: an unknown key or category becomes the generic line. */
import { GENERIC_BODY, GENERIC_TITLE, lookup } from './messages.js';
import { parseAction } from './actions.js';
import type { Notification } from './inbox.js';

/** Control characters, escape sequences and bidi/line-separator tricks are removed from anything that reaches a screen or the OS. */
export function sanitise(s: string): string {
  return s.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\u001b[@-Z\\-_]?/g, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim();
}
/** Parameters may be ids (like `ses_01J...`), short plain words and numbers; anything else is replaced by an ellipsis so free text cannot ride in. */
const SAFE_PARAM = /^[A-Za-z0-9_.:@/+-]{1,64}$/;
function interpolate(t: string, params: Record<string, unknown> | undefined): string {
  return t.replace(/\{([a-z_]+)\}/g, (_m, k: string) => { const v = params?.[k]; if (typeof v === 'number' && Number.isFinite(v)) return String(v); return typeof v === 'string' && SAFE_PARAM.test(v) ? v : '…'; });
}
export function render(n: Notification, _locale = 'en'): { title: string; body: string; actionLabel?: string } {
  const t = lookup(String(n.title_key)); const b = lookup(String(n.body_key));
  const title = sanitise(t ? interpolate(t, n.params) : GENERIC_TITLE) || GENERIC_TITLE; const body = sanitise(b ? interpolate(b, n.params) : GENERIC_BODY) || GENERIC_BODY;
  const a = parseAction(n); return { title, body, ...(a.kind === 'open_session' ? { actionLabel: lookup('notif.action.open_session') ?? 'Open' } : {}) };
}
