import { failure, errCode, errStatus, type Http } from '../workspace/data.js';
import type { KeyHolder } from './fragment.js';
import { isToken } from './deeplink.js';
import { fragmentOf } from '../session/handoff.js';

export interface Preview { workspace_name: string; inviter_name: string; role: string; expires_at: string; has_key_bundle?: boolean }
export type PreviewResult = { state: 'ready'; preview: Preview } | { state: 'invalid' } | { state: 'error' };
/** Looks the invite up. A malformed token is invalid without any request; an expired, revoked or used invite all look the same. */
export async function previewInvite(http: Http, token: string, signal?: AbortSignal): Promise<PreviewResult> {
  if (!isToken(token)) return { state: 'invalid' };
  try { const r = await http.call('previewInvite', { token }, { signal }); const p = r.data as Preview; return p && typeof p.workspace_name === 'string' ? { state: 'ready', preview: p } : { state: 'invalid' }; } catch (e) { const s = errStatus(e); return s === 404 || s === 409 || s === 410 || s === 400 || errCode(e) === 'not_found' || errCode(e) === 'gone' ? { state: 'invalid' } : { state: 'error' }; }
}
export const INVALID_TEXT = "This invite isn't valid anymore."; export const HELP_TEXT = 'Ask for a new link.';
export type Opener = (bundle: unknown, key: Uint8Array) => Promise<void>;
export type AcceptResult = { state: 'joined'; workspace?: unknown; keyed: boolean; /** a session invite: the session to open */ session?: string } | { state: 'waiting_for_key'; workspace?: unknown; session?: string } | { state: 'invalid' } | { state: 'signed_out' } | { state: 'error'; retryAfterS?: number };
/** Accepting needs a click and a signed-in person. After it the key bundle is fetched once (three tries, 500 ms doubling) and opened with the fragment key, which is then zeroed, except when the accept itself failed in a way worth retrying (a network or server error: the address no longer has the key, so this copy is the only one). */
export async function acceptInvite(http: Http, token: string, o: { key: KeyHolder; open: Opener; sleep(ms: number): Promise<void>; signedIn: boolean; /** a session invite is opened by the session page, which fetches the key bundle itself (it can be fetched only once) */ handOff?: (h: { session: string; token: string; secret?: string }) => void }): Promise<AcceptResult> {
  let keep = false; // the key survives only a failure the person can retry
  try {
    if (!o.signedIn) return { state: 'signed_out' }; if (!isToken(token)) return { state: 'invalid' };
    let workspace: unknown; try { workspace = (await http.call('acceptInvite', { token }, {})).data; } catch (e) { const s = errStatus(e); if (s === 401) return { state: 'signed_out' }; if (s === 404 || s === 410 || s === 409) return { state: 'invalid' }; const f = failure(e); keep = true; return { state: 'error', retryAfterS: f.retryAfterS }; }
    const session = (workspace as { session?: unknown } | null)?.session;
    if (typeof session === 'string' && o.handOff) { const secret = o.key.present ? o.key.use(fragmentOf) : undefined; o.handOff({ session, token, ...(secret ? { secret } : {}) }); return secret ? { state: 'joined', workspace, keyed: true, session } : { state: 'waiting_for_key', workspace, session }; }
    if (!o.key.present) return { state: 'waiting_for_key', workspace };
    for (let i = 0; i < 3; i++) { try { const bundle = (await http.call('getInviteKeyBundle', { token })).data; await o.key.use((k) => o.open(bundle, k)); return { state: 'joined', workspace, keyed: true }; } catch (e) { const s = errStatus(e); if (s === 404 || s === 410) return { state: 'waiting_for_key', workspace }; if (i < 2) await o.sleep(500 * 2 ** i); } }
    return { state: 'waiting_for_key', workspace };
  } finally { if (!keep) o.key.zero(); }
}
export type ShareResult = { state: 'joined'; session?: unknown } | { state: 'invalid' } | { state: 'rate_limited'; retryAfterS: number } | { state: 'error' };
/** A share link joins as a limited viewer without an account. */
export async function joinViaShare(http: Http, token: string): Promise<ShareResult> {
  if (!isToken(token)) return { state: 'invalid' }; try { return { state: 'joined', session: (await http.call('joinViaShareLink', { token }, {})).data }; } catch (e) { const f = failure(e); if (f.reason === 'rate_limited') return { state: 'rate_limited', retryAfterS: f.retryAfterS ?? 1 }; const s = errStatus(e); return s === 404 || s === 410 ? { state: 'invalid' } : { state: 'error' }; }
}
