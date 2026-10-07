import { HARD_SIGNOUT } from './errors.js';
import { getAccessToken, refreshAccessToken, type AuthDeps } from './refresh.js';
import { peekToken, setState, setToken, type Me } from './store.js';

/** Signs out in this tab; `notice` tells the login screen why. */
export function localSignOut(notice?: 'safety' | 'cookies_blocked' | 'expired'): void { setToken(undefined); setState({ status: 'anonymous', user: undefined, ...(notice ? { notice } : { notice: undefined }) }); }
export async function signOut(d: AuthDeps): Promise<void> { const { token } = peekToken(); try { if (token) await d.fetch(`${d.apiBase}/v1/auth/revoke`, { method: 'POST', credentials: 'include', headers: { authorization: `Bearer ${token}`, 'X-Centcom-Client': 'web', 'content-type': 'application/json' }, body: '{}' }); } catch { /* the token is dropped here either way */ } localSignOut(); d.channel?.postMessage({ t: 'signout' }); }
const problemCode = async (r: Response): Promise<string> => { const p = await r.clone().json().catch(() => ({})) as { code?: string; type?: string }; return p.code ?? String(p.type ?? '').split('/').pop() ?? ''; };
/** fetch with the bearer token. A 401 `token_expired` refreshes once and retries once; a second 401 signs out; the codes that mean the session is over sign out without a refresh. */
export function makeAuthedFetch(d: AuthDeps): (input: string, init?: RequestInit) => Promise<Response> {
  const send = async (input: string, init: RequestInit | undefined, token: string): Promise<Response> => d.fetch(input, { ...init, credentials: 'include', headers: { ...(init?.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` } });
  return async (input, init) => {
    let res = await send(input, init, await getAccessToken(d)); if (res.status !== 401) return res; const code = await problemCode(res);
    if (code === 'refresh_reuse_detected') { localSignOut('safety'); return res; } if (HARD_SIGNOUT.has(code)) { localSignOut(); return res; }
    if (code !== 'token_expired') return res;
    try { await refreshAccessToken(d); } catch (e) { const sc = (e as { serverCode?: string }).serverCode; localSignOut(sc === 'refresh_reuse_detected' ? 'safety' : (e as { code?: string }).code === 'cookies_blocked' ? 'cookies_blocked' : 'expired'); return res; }
    res = await send(input, init, peekToken().token ?? ''); if (res.status === 401) { localSignOut('expired'); } return res;
  };
}
/** `GET /v1/me`: the plan, the active workspace and the entitlement revision for the other pages. */
export async function bootstrap(d: AuthDeps, f: (i: string) => Promise<Response>): Promise<Me | undefined> { try { const r = await f(`${d.apiBase}/v1/me`); if (!r.ok) return undefined; const me = await r.json() as Me; setState({ status: 'authenticated', user: me }); return me; } catch { return undefined; } }
/** Refreshes shortly before expiry, and again when the tab wakes up (timers sleep with the tab). */
export function startRefreshTimer(d: AuthDeps, o: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void; onVisible(fn: () => void): () => void }): () => void {
  let h: unknown; const arm = (): void => { if (h !== undefined) o.clearTimeout(h); const { token, expiresAt } = peekToken(); if (!token) return; h = o.setTimeout(() => { void getAccessToken(d).then(arm).catch(() => undefined); }, Math.max(1000, expiresAt - d.now() - 60_000)); };
  const off = o.onVisible(() => { const { token, expiresAt } = peekToken(); if (token && expiresAt - d.now() < 60_000) void getAccessToken(d).then(arm).catch(() => undefined); else arm(); }); arm(); return () => { if (h !== undefined) o.clearTimeout(h); off(); };
}
export const requireAuth = (s: { status: string }, here: string): { redirect: string } | null => (s.status === 'authenticated' ? null : { redirect: `/login?returnTo=${encodeURIComponent(here)}` });
export const requireRole = (me: { role?: string } | undefined, roles: string[]): boolean => !!me?.role && roles.includes(me.role);
