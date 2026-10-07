import { beforeEach, describe, expect, it } from 'vitest';
import { refreshAccessToken, resetRefresh } from '../../src/auth/refresh.js';
import { localSignOut, makeAuthedFetch, signOut, startRefreshTimer } from '../../src/auth/session.js';
import { getState, peekToken, reset, setState, setToken } from '../../src/auth/store.js';
import { deps, json, problem } from './helpers.js';

beforeEach(() => { reset(); resetRefresh(); setToken('T0', 900, 1_000_000); setState({ status: 'authenticated' }); });
const API = 'https://api.centcom.dev/v1/workspaces';
function server(first: Response | (() => Response), o: { refresh?: Response | (() => Response); then?: Response } = {}) { let api = 0; const log: string[] = []; return { log, impl: async (url: string): Promise<Response> => { if (url.endsWith('/v1/auth/token')) { log.push('refresh'); const r = o.refresh ?? json(200, { access_token: 'T1', expires_in: 900 }); return typeof r === 'function' ? r() : r.clone(); } log.push('api'); api++; if (api === 1) return typeof first === 'function' ? first() : first.clone(); return o.then?.clone() ?? json(200, { ok: true }); } }; }
describe('401 handling (acceptance 6)', () => {
  it('token_expired: one refresh, one retry, and the retry uses the new token', async () => {
    const s = server(problem(401, 'token_expired')); const d = deps(s.impl); const res = await makeAuthedFetch(d)(API); expect(res.status).toBe(200); expect(s.log).toEqual(['api', 'refresh', 'api']); expect(new Headers(d.calls[2]!.init!.headers as never).get('authorization')).toBe('Bearer T1'); expect(new Headers(d.calls[0]!.init!.headers as never).get('authorization')).toBe('Bearer T0'); expect(getState().status).toBe('authenticated');
  });
  it('a second 401 after the refresh signs out', async () => { const s = server(problem(401, 'token_expired'), { then: problem(401, 'token_expired') }); await makeAuthedFetch(deps(s.impl))(API); expect(s.log).toEqual(['api', 'refresh', 'api']); expect(getState().status).toBe('anonymous'); expect(peekToken().token).toBeUndefined(); });
  for (const code of ['token_revoked', 'device_revoked', 'token_invalid']) it(`${code}: signs out with no refresh`, async () => { const s = server(problem(401, code)); await makeAuthedFetch(deps(s.impl))(API); expect(s.log).toEqual(['api']); expect(getState()).toMatchObject({ status: 'anonymous' }); expect(peekToken().token).toBeUndefined(); });
  it('refresh_reuse_detected (on the request or the refresh) signs out and says so', async () => {
    let s = server(problem(401, 'refresh_reuse_detected')); await makeAuthedFetch(deps(s.impl))(API); expect(getState()).toMatchObject({ status: 'anonymous', notice: 'safety' }); expect(s.log).toEqual(['api']);
    setToken('T0', 900, 1_000_000); setState({ status: 'authenticated', notice: undefined }); s = server(problem(401, 'token_expired'), { refresh: problem(401, 'refresh_reuse_detected') }); await makeAuthedFetch(deps(s.impl))(API); expect(getState()).toMatchObject({ status: 'anonymous', notice: 'safety' });
  });
  it('a refresh refused with 401 and no reuse means the browser blocked the cookie', async () => { const s = server(problem(401, 'token_expired'), { refresh: problem(401, 'unauthorized') }); await makeAuthedFetch(deps(s.impl))(API); expect(getState()).toMatchObject({ status: 'anonymous', notice: 'cookies_blocked' }); });
  it('other statuses pass through untouched and need no refresh', async () => { const s = server(json(403, { code: 'forbidden' })); const r = await makeAuthedFetch(deps(s.impl))(API); expect(r.status).toBe(403); expect(s.log).toEqual(['api']); expect(getState().status).toBe('authenticated'); });
});
describe('sign out and timers (acceptance 7, 8)', () => {
  it('sign-out revokes on the server, clears memory and tells the other tabs', async () => {
    const posted: unknown[] = []; const d = deps(async () => json(200, {}), { channel: { postMessage: (m) => void posted.push(m), addEventListener: () => undefined } }); await signOut(d); expect(d.calls[0]!.url).toBe('https://api.centcom.dev/v1/auth/revoke'); expect(new Headers(d.calls[0]!.init!.headers as never).get('authorization')).toBe('Bearer T0'); expect(peekToken().token).toBeUndefined(); expect(getState().status).toBe('anonymous'); expect(posted).toEqual([{ t: 'signout' }]);
  });
  it('a signout message from another tab makes this one anonymous at once', async () => { const { listen } = await import('../../src/auth/refresh.js'); let fn!: (e: { data: unknown }) => void; listen(deps(async () => json(200, {}), { channel: { postMessage: () => undefined, addEventListener: (_t, f) => { fn = f; } } }), () => localSignOut()); fn({ data: { t: 'signout' } }); expect(getState().status).toBe('anonymous'); });
  it('the token is refreshed 60 s before it ends, and when the tab wakes up late', async () => {
    const timers: { fn: () => void; ms: number }[] = []; let visible: () => void = () => undefined; let now = 1_000_000; const d = deps(async () => json(200, { access_token: 'T9', expires_in: 900 }), { now: () => now }); setToken('T0', 900, now);
    const stop = startRefreshTimer(d, { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => undefined, onVisible: (f) => { visible = f; return () => undefined; } }); expect(timers[0]!.ms).toBe(900_000 - 60_000);
    now += 880_000; visible(); await new Promise((r) => setTimeout(r, 40)); expect(peekToken().token).toBe('T9'); stop(); void refreshAccessToken;
  });
});
