/** One refresh at a time across tabs: a Web Lock serialises them and a BroadcastChannel shares the result, so two tabs that expire together cause one request. */
import { setToken, peekToken } from './store.js';
import { AuthError } from './errors.js';

export interface AuthDeps {
  fetch: typeof fetch; apiBase: string; now(): number; locks?: { request<T>(name: string, cb: () => Promise<T>): Promise<T> };
  channel?: { postMessage(m: unknown): void; addEventListener(t: 'message', fn: (e: { data: unknown }) => void): void; close?(): void }; clientId?: string; setTimeout?: (fn: () => void, ms: number) => unknown; clearTimeout?: (h: unknown) => void;
}
export const REFRESH_MARGIN_MS = 60_000; export const LOCK = 'centcom-refresh'; export const CHANNEL = 'centcom-auth';
export interface TokenReply { access_token: string; expires_in: number }
let inflight: Promise<string> | undefined;
export const resetRefresh = (): void => { inflight = undefined; };
/** Listens for tokens other tabs share; returns what to call to stop. */
export function listen(d: AuthDeps, onSignOut: () => void): void { d.channel?.addEventListener('message', (e) => { const m = e.data as { t?: string; token?: string; expiresAt?: number }; if (m?.t === 'token' && typeof m.token === 'string' && typeof m.expiresAt === 'number') setToken(m.token, Math.max(1, Math.round((m.expiresAt - d.now()) / 1000)), d.now()); else if (m?.t === 'signout') onSignOut(); }); }
export async function requestToken(d: AuthDeps, body: Record<string, string>): Promise<Response> {
  return d.fetch(`${d.apiBase}/v1/auth/token`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'X-Centcom-Client': 'web' }, body: JSON.stringify({ client_id: 'centcom-web', ...body }) });
}
/** The refresh token is an HttpOnly cookie the browser sends: nothing about it is in the body or the URL. */
export function refreshAccessToken(d: AuthDeps): Promise<string> {
  inflight ??= (async () => {
    try {
      const run = async (): Promise<string> => {
        const before = peekToken(); /* another tab may have refreshed while this one waited for the lock */
        if (before.token && before.expiresAt - d.now() > REFRESH_MARGIN_MS && waited) return before.token;
        let r: Response; try { r = await requestToken(d, { grant_type: 'refresh_token' }); } catch { throw new AuthError('network'); }
        if (!r.ok) { const p = await r.json().catch(() => ({})) as { code?: string; type?: string }; const code = p.code ?? String(p.type ?? '').split('/').pop(); const e = new AuthError(r.status === 401 && code !== 'refresh_reuse_detected' ? 'cookies_blocked' : 'exchange_failed') as AuthError & { serverCode?: string }; e.serverCode = code; throw e; }
        const j = await r.json() as TokenReply; setToken(j.access_token, j.expires_in, d.now()); d.channel?.postMessage({ t: 'token', token: j.access_token, expiresAt: d.now() + j.expires_in * 1000 }); return j.access_token;
      };
      let waited = false; if (d.locks) return await d.locks.request(LOCK, async () => { waited = true; return run(); }); return await run();
    } finally { inflight = undefined; }
  })();
  return inflight;
}
/** The token to use now: the one in memory, or a fresh one when less than 60 s remain. */
export async function getAccessToken(d: AuthDeps): Promise<string> { const { token, expiresAt } = peekToken(); if (token && expiresAt - d.now() > REFRESH_MARGIN_MS) return token; return refreshAccessToken(d); }
