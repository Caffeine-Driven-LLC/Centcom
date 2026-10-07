/** Authorization code + PKCE (RFC 7636, S256 only) for the desktop custom scheme: start (verifier, challenge, state, authorize URL) and complete from the callback URL.
 *  Must not: offer `plain`; compare `state` in anything but constant time; accept tokens from a URL (only the one-time `code`); send anything before the callback is checked; log the verifier or the code. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { b64u } from '@centcom/protocol';
import { DEFAULT_BASE_URL, type HttpClient } from '../http/index.js';
import { PkceCallbackError } from './errors.js';
import { tokenSetFrom, type TokenSet } from './types.js';

export const DESKTOP_REDIRECT_URI = 'centcom://auth/callback';

/** base64url(SHA-256(verifier)), the S256 challenge. */
export function s256Challenge(verifier: string): string { return b64u.encode(createHash('sha256').update(verifier, 'ascii').digest()); }

/** What `pkceStart` returns. Keep `state` and `verifier` in memory until the callback arrives. */
export interface PkceStart { url: string; state: string; verifier: string }
/** What `pkceComplete` needs besides the callback URL. */
export interface PkcePending { state: string; verifier: string; clientId: string; redirectUri?: string; http: HttpClient; signal?: AbortSignal }

/** Make a verifier (32 random bytes, 43 characters), its S256 challenge, a state (32 random bytes) and the authorize URL. */
export function pkceStart(o: { redirectUri: typeof DESKTOP_REDIRECT_URI; clientId: string; scopes: string; baseUrl?: string; random?: (n: number) => Uint8Array }): PkceStart {
  const random = o.random ?? ((n: number) => new Uint8Array(randomBytes(n)));
  const verifier = b64u.encode(random(32)); const state = b64u.encode(random(32));
  const u = new URL('/v1/auth/authorize', o.baseUrl ?? DEFAULT_BASE_URL);
  u.search = new URLSearchParams({ response_type: 'code', client_id: o.clientId, redirect_uri: o.redirectUri, code_challenge: s256Challenge(verifier), code_challenge_method: 'S256', scope: o.scopes, state }).toString();
  return { url: u.toString(), state, verifier };
}

/** Equal-length buffers compared in constant time; a length difference is still compared (against itself) so timing does not show where they differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8'); const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length) { timingSafeEqual(x, x); return false; }
  return timingSafeEqual(x, y);
}

const used = new WeakSet<PkcePending>();

/** Check the callback (exact redirect, constant-time state, a code, no error) before any network call, then exchange the code once. */
export async function pkceComplete(callbackUrl: string, pending: PkcePending): Promise<TokenSet> {
  const redirect = pending.redirectUri ?? DESKTOP_REDIRECT_URI;
  let u: URL; try { u = new URL(callbackUrl); } catch { throw new PkceCallbackError('redirect_mismatch'); }
  if (`${u.protocol}//${u.host}${u.pathname}` !== redirect || u.hash) throw new PkceCallbackError('redirect_mismatch');
  const q = u.searchParams;
  if (q.getAll('state').length !== 1 || !constantTimeEqual(q.get('state') ?? '', pending.state)) throw new PkceCallbackError('state_mismatch');
  if (q.has('error')) throw new PkceCallbackError('server_error');
  const code = q.get('code'); if (!code || q.getAll('code').length !== 1) throw new PkceCallbackError('missing_code');
  if (used.has(pending)) throw new PkceCallbackError('replayed');
  used.add(pending); /* one exchange per start, even if this one fails */
  const r = await pending.http.call('issueToken', { body: { grant_type: 'authorization_code', code, code_verifier: pending.verifier, redirect_uri: redirect, client_id: pending.clientId } }, { signal: pending.signal });
  return tokenSetFrom(r.data);
}
