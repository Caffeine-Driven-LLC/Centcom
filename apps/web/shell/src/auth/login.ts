import { AuthError } from './errors.js';
import { b64url, challengeS256, constantTimeEqual, randomState, randomVerifier, safeReturnTo } from './pkce.js';
import { requestToken, type AuthDeps, type TokenReply } from './refresh.js';
import { setToken } from './store.js';

const KEY = 'centcom.pkce';
export interface LoginEnv { storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; location: { origin: string; assign(url: string): void }; history: { replaceState(s: unknown, t: string, u: string): void }; random?: (n: number) => Uint8Array; subtle?: SubtleCrypto }
export const REDIRECT_PATH = '/auth/callback';
export interface DevicePub { x25519: string; ed25519: string }
/** Redirects to the authorize endpoint. The verifier stays in sessionStorage until the callback uses it once. */
export async function startLogin(d: Pick<AuthDeps, 'apiBase'>, env: LoginEnv, opts: { returnTo?: string; device?: { pubkeys?: DevicePub; name?: string } } = {}): Promise<string> {
  const verifier = randomVerifier(env.random); const state = randomState(env.random); const challenge = await challengeS256(verifier, env.subtle); const returnTo = safeReturnTo(opts.returnTo);
  env.storage.setItem(KEY, JSON.stringify({ verifier, state, returnTo }));
  const q = new URLSearchParams({ response_type: 'code', client_id: 'centcom-web', redirect_uri: `${env.location.origin}${REDIRECT_PATH}`, code_challenge: challenge, code_challenge_method: 'S256', state });
  if (opts.device?.pubkeys) q.set('device_pubkeys', b64url(new TextEncoder().encode(JSON.stringify(opts.device.pubkeys)))); if (opts.device?.name) q.set('device_name', opts.device.name.slice(0, 64));
  const url = `${d.apiBase}/v1/auth/authorize?${q}`; env.location.assign(url); return url;
}
/** The callback: checks `state`, trades the code once, keeps the token in memory, and removes the query from the address at once. */
export async function completeLogin(url: URL, d: AuthDeps, env: LoginEnv): Promise<{ returnTo: string }> {
  const raw = env.storage.getItem(KEY); env.storage.removeItem(KEY); /* single use, success or failure */
  env.history.replaceState(null, '', REDIRECT_PATH);
  if (!raw) throw new AuthError('no_pending_login'); let pending: { verifier: string; state: string; returnTo: string }; try { pending = JSON.parse(raw); } catch { throw new AuthError('no_pending_login'); }
  const got = url.searchParams.get('state'); if (!got || !constantTimeEqual(got, pending.state)) throw new AuthError('state_mismatch');
  if (url.searchParams.get('error')) throw new AuthError('access_denied'); const code = url.searchParams.get('code'); if (!code) throw new AuthError('exchange_failed');
  let r: Response; try { r = await requestToken(d, { grant_type: 'authorization_code', code, code_verifier: pending.verifier, redirect_uri: `${env.location.origin}${REDIRECT_PATH}` }); } catch { throw new AuthError('network'); }
  if (!r.ok) throw new AuthError('exchange_failed'); const j = await r.json() as TokenReply; setToken(j.access_token, j.expires_in, d.now());
  env.history.replaceState(null, '', safeReturnTo(pending.returnTo)); return { returnTo: safeReturnTo(pending.returnTo) };
}
