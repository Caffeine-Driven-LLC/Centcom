import { parseEnv } from '../lib/env.js';
import { ensureDeviceKeys, idbKeyStore } from './devicekeys.js';
import { type LoginEnv, completeLogin, startLogin } from './login.js';
import { CHANNEL, getAccessToken, listen, type AuthDeps } from './refresh.js';
import { bootstrap, localSignOut, makeAuthedFetch, signOut as doSignOut, startRefreshTimer } from './session.js';
import { setState, useAuthState } from './store.js';

let deps: AuthDeps | undefined; let started = false;
/** The real browser dependencies, built on first use. */
export function runtime(): { deps: AuthDeps; env: LoginEnv } {
  const { env } = parseEnv(import.meta.env as Record<string, unknown>);
  deps ??= { fetch: (i, o) => fetch(i, o), apiBase: env.apiBase, now: () => Date.now(), ...(typeof navigator !== 'undefined' && 'locks' in navigator ? { locks: navigator.locks as never } : {}), ...(typeof BroadcastChannel !== 'undefined' ? { channel: new BroadcastChannel(CHANNEL) as never } : {}) };
  const desk = window.centcom; return { deps, env: { storage: sessionStorage, location: window.location, history: window.history, ...(desk ? { redirectUri: 'centcom://auth/callback', open: (u: string) => void desk.openExternal(u) } : {}) } };
}
export const authedFetch = (input: string, init?: RequestInit): Promise<Response> => makeAuthedFetch(runtime().deps)(input, init);
export { getAccessToken as getAccessTokenWith };
export const getToken = (): Promise<string> => getAccessToken(runtime().deps);
export async function login(returnTo?: string): Promise<void> { const { deps: d, env } = runtime(); const k = await ensureDeviceKeys(idbKeyStore()); setState({ viewerOnly: k.viewerOnly }); await startLogin(d, env, { returnTo, device: { pubkeys: k.pubkeys, name: 'Web browser' } }); }
export async function callback(url: URL): Promise<{ returnTo: string }> { const { deps: d, env } = runtime(); const r = await completeLogin(url, d, env); await bootstrap(d, makeAuthedFetch(d)); return r; }
export const signOut = (): Promise<void> => doSignOut(runtime().deps);
/** Called once at start: shares tokens and sign-outs between tabs, refreshes before expiry, and tries a silent refresh with the cookie. */
export async function startAuth(): Promise<void> {
  if (started) return; started = true; const { deps: d } = runtime(); listen(d, () => localSignOut()); startRefreshTimer(d, { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as number), onVisible: (f) => { const g = (): void => { if (document.visibilityState === 'visible') f(); }; document.addEventListener('visibilitychange', g); return () => document.removeEventListener('visibilitychange', g); } });
  try { await getAccessToken(d); await bootstrap(d, makeAuthedFetch(d)); } catch { setState({ status: 'anonymous' }); }
}
export function useAuth(): { status: ReturnType<typeof useAuthState>['status']; user: ReturnType<typeof useAuthState>['user']; notice: ReturnType<typeof useAuthState>['notice']; viewerOnly?: boolean; signOut(): Promise<void> } { const s = useAuthState(); return { status: s.status, user: s.user, notice: s.notice, viewerOnly: s.viewerOnly, signOut }; }
