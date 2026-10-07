import { beforeEach, describe, expect, it } from 'vitest';
import { AuthError } from '../../src/auth/errors.js';
import { BACKOFF_CAP_MS, QUEUE_MAX, QUEUE_WAIT_MS, RefreshOutage, backoffMs } from '../../src/auth/outage.js';
import { resetRefresh } from '../../src/auth/refresh.js';
import { makeAuthedFetch, startRefreshTimer } from '../../src/auth/session.js';
import { getState, peekToken, reset, setState, setToken } from '../../src/auth/store.js';
import { deps, json, problem } from './helpers.js';

/** A clock the test moves by hand. */
function clock() { let t = 1_000_000; const q: { at: number; fn: () => void; h: number }[] = []; let id = 0; return { now: () => t, setTimeout: (fn: () => void, ms: number) => { const h = ++id; q.push({ at: t + ms, fn, h }); return h; }, clearTimeout: (h: unknown) => { const i = q.findIndex((x) => x.h === h); if (i >= 0) q.splice(i, 1); }, async advance(ms: number) { const end = t + ms; for (;;) { q.sort((a, b) => a.at - b.at); const n = q[0]; if (!n || n.at > end) break; q.shift(); t = n.at; n.fn(); for (let i = 0; i < 6; i++) await Promise.resolve(); } t = end; await new Promise((r) => setTimeout(r, 0)); }, pending: () => q.length }; }
beforeEach(() => { reset(); resetRefresh(); setState({ status: 'authenticated' }); });
describe('network down while refreshing (failure mode)', () => {
  it('backs off 500 ms x 2^n and never beyond 30 s', () => { expect([0, 1, 2, 3, 6, 7, 20].map(backoffMs)).toEqual([500, 1000, 2000, 4000, 30_000, BACKOFF_CAP_MS, BACKOFF_CAP_MS]); });
  it('stays signed in, retries on the backoff schedule, and every waiting request gets the new token when the network is back', async () => {
    const c = clock(); let up = false; const attempts: number[] = []; const d = deps(async (url) => { if (url.endsWith('/v1/auth/token')) { attempts.push(c.now()); if (!up) throw new TypeError('network down'); return json(200, { access_token: 'NEW', expires_in: 900 }); } return json(200, {}); }, { now: c.now, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
    setToken('OLD', 30, c.now()); const o = new RefreshOutage(d); const waiting = [o.token(), o.token(), o.token()]; await new Promise((r) => setTimeout(r, 0)); expect(o.waiting).toBe(3); expect(getState().status).toBe('authenticated'); expect(attempts).toHaveLength(1);
    await c.advance(500); expect(attempts).toHaveLength(2); await c.advance(1000); expect(attempts).toHaveLength(3); expect(attempts.slice(1).map((t, i) => t - attempts[i]!)).toEqual([500, 1000]); up = true; await c.advance(2000); expect(await Promise.all(waiting)).toEqual(['NEW', 'NEW', 'NEW']); expect(peekToken().token).toBe('NEW'); expect(o.attempt).toBe(0); expect(attempts.length).toBeLessThanOrEqual(5);
  });
  it('a request waits at most 10 s and then fails with the typed network error; the 21st fails at once', async () => {
    const c = clock(); const d = deps(async () => { throw new TypeError('down'); }, { now: c.now, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout }); setToken('OLD', 10, c.now()); const o = new RefreshOutage(d); const errs: unknown[] = []; const reqs = Array.from({ length: QUEUE_MAX }, () => o.token().catch((e) => errs.push(e))); await new Promise((r) => setTimeout(r, 0)); expect(o.waiting).toBe(QUEUE_MAX);
    await expect(o.token()).rejects.toMatchObject({ code: 'network' }); await c.advance(QUEUE_WAIT_MS - 1); expect(errs).toHaveLength(0); await c.advance(1); await Promise.all(reqs); expect(errs).toHaveLength(QUEUE_MAX); expect(errs.every((e) => e instanceof AuthError && e.code === 'network')).toBe(true); expect(o.waiting).toBe(0); expect(getState().status).toBe('authenticated'); o.dispose();
  });
  it('a refusal that is not about the network still ends the session at once', async () => { const d = deps(async () => problem(401, 'refresh_reuse_detected')); setToken('OLD', 10, 1_000_000); await expect(new RefreshOutage(d).token()).rejects.toMatchObject({ serverCode: 'refresh_reuse_detected' }); });
  it('authedFetch: an offline retry refresh keeps the session and throws the typed error instead of signing out', async () => {
    setToken('T0', 900, 1_000_000); let api = 0; const d = deps(async (url) => { if (url.endsWith('/v1/auth/token')) throw new TypeError('down'); api++; return problem(401, 'token_expired'); }); await expect(makeAuthedFetch(d)('https://api.centcom.dev/v1/me')).rejects.toMatchObject({ code: 'network' }); expect(api).toBe(1); expect(getState().status).toBe('authenticated'); expect(peekToken().token).toBe('T0');
  });
});
describe('refresh before the request, and the timer, end the session on a reuse (the path the review found)', () => {
  it('a token inside its last minute is refreshed first; a reuse signs out with the safety notice and no request goes out', async () => {
    setToken('T0', 30, 1_000_000); let api = 0; const d = deps(async (url) => { if (url.endsWith('/v1/auth/token')) return problem(401, 'refresh_reuse_detected'); api++; return json(200, {}); }); await expect(makeAuthedFetch(d)('https://api.centcom.dev/v1/me')).rejects.toBeTruthy(); expect(api).toBe(0); expect(getState()).toMatchObject({ status: 'anonymous', notice: 'safety' });
  });
  it('the refresh timer does the same when the refresh is refused with reuse, and with a blocked cookie', async () => {
    for (const [serverCode, notice] of [['refresh_reuse_detected', 'safety'], ['unauthorized', 'cookies_blocked']] as const) { reset(); resetRefresh(); setState({ status: 'authenticated' }); setToken('T0', 50, 1_000_000); const timers: (() => void)[] = []; const d = deps(async () => problem(401, serverCode)); startRefreshTimer(d, { setTimeout: (f) => { timers.push(f); return 1; }, clearTimeout: () => undefined, onVisible: () => () => undefined }); timers[0]!(); await new Promise((r) => setTimeout(r, 20)); expect(getState()).toMatchObject({ status: 'anonymous', notice }); }
  });
});
