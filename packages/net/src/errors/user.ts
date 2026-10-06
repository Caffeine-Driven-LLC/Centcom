import { CentcomError } from './error.js';
import { LOCAL_MESSAGES, MESSAGES, classMessage } from './messages.en.js';
import { looksLikeSecret } from '@centcom/protocol';

export interface UserMessage { title: string; hint?: string; /** the server's own explanation, only when it is short and safe */ detail?: string; /** `Ref: req_...` for support */ ref?: string }
const MAX_SHOWN_DETAIL = 200;

/** People see the message table, never raw server text. A short, clean `detail` is added as extra context. */
export function userMessage(e: CentcomError, _locale = 'en'): UserMessage {
  const base = e.kind !== 'api' ? LOCAL_MESSAGES[e.kind] : e.code !== 'unknown' ? MESSAGES[e.code] : classMessage(e.status);
  const d = e.detail && e.detail.length <= MAX_SHOWN_DETAIL && !looksLikeSecret(e.detail) && !/https?:\/\/\S+\?\S/.test(e.detail) ? e.detail : undefined;
  return { title: base.title, ...('hint' in base && base.hint ? { hint: base.hint } : {}), ...(d && d !== base.title ? { detail: d } : {}), ...(e.requestId ? { ref: `Ref: ${e.requestId}` } : {}) };
}

export type NextAction = 'refresh' | 'reauthenticate' | 'upgrade' | 'show_quota' | 'show_forbidden' | 'retry' | 'none';
/** What the app should do about it. */
export function nextAction(e: CentcomError): NextAction {
  if (e.kind === 'network' || e.kind === 'timeout') return 'retry';
  if (e.kind !== 'api') return 'none';
  switch (e.code) {
    case 'token_expired': return 'refresh';
    case 'token_invalid': case 'token_revoked': case 'device_revoked': case 'refresh_reuse_detected': case 'unauthorized': return 'reauthenticate';
    case 'client_too_old': return 'upgrade';
    case 'quota_exceeded': return 'show_quota';
    case 'forbidden': case 'role_insufficient': case 'not_a_member': case 'owner_required': case 'host_required': return 'show_forbidden';
  }
  if (e.status === 401) return 'reauthenticate';
  if (e.status === 408 || e.status === 425 || e.status === 429 || (e.status !== undefined && e.status >= 500)) return 'retry';
  return 'none';
}
