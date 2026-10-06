import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MockBackend } from '@centcom/testkit';
import { DESKTOP_REDIRECT_URI, PkceCallbackError, constantTimeEqual, createHttpClient, pkceComplete, pkceStart, s256Challenge } from '../../src/index.js';
import { AutoClock, NO_TIMEOUT, UA, json } from '../http/helpers.js';
import { authMock, fakeJwt, tokenBody } from './helpers.js';

let m: MockBackend | undefined; afterEach(async () => { await m?.stop(); m = undefined; });
const start = () => pkceStart({ redirectUri: DESKTOP_REDIRECT_URI, clientId: 'centcom-cli', scopes: 'profile sessions:read' });
const fetchOk = () => vi.fn(async () => json(200, tokenBody(fakeJwt({ exp: 2_000_000_000 }), 'rt_pk')));
const httpWith = (f: ReturnType<typeof fetchOk>) => createHttpClient({ getAccessToken: async () => undefined, baseUrl: 'https://api.centcom.dev', userAgent: UA, fetch: f as never, clock: new AutoClock(), timeoutMs: NO_TIMEOUT });

describe('S256 (RFC 7636)', () => {
  it('matches the RFC 7636 appendix B test vector', () => {
    expect(s256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('the authorize URL carries S256, a 43+ char challenge of the verifier, the custom-scheme redirect and the state (acceptance 10)', () => {
    const s = start(); const u = new URL(s.url); const q = u.searchParams;
    expect(u.origin + u.pathname).toBe('https://api.centcom.dev/v1/auth/authorize');
    expect(q.get('code_challenge_method')).toBe('S256'); expect(q.get('code_challenge')!.length).toBeGreaterThanOrEqual(43); expect(q.get('code_challenge')).toBe(s256Challenge(s.verifier));
    expect(q.get('redirect_uri')).toBe('centcom://auth/callback'); expect(s.url).toContain('redirect_uri=centcom%3A%2F%2Fauth%2Fcallback');
    expect(q.get('state')).toBe(s.state); expect(q.get('response_type')).toBe('code'); expect(q.get('client_id')).toBe('centcom-cli'); expect(q.get('scope')).toBe('profile sessions:read');
    expect(s.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(q.has('code_verifier')).toBe(false); expect(s.url).not.toContain('plain');
  });
  it('every start is fresh, and the base URL can be changed', () => {
    const a = start(); const b = start(); expect(a.verifier).not.toBe(b.verifier); expect(a.state).not.toBe(b.state);
    expect(pkceStart({ redirectUri: DESKTOP_REDIRECT_URI, clientId: 'centcom-cli', scopes: 'profile', baseUrl: 'http://127.0.0.1:9' }).url.startsWith('http://127.0.0.1:9/v1/auth/authorize?')).toBe(true);
  });
});

describe('completing from the callback URL', () => {
  it('exchanges the one-time code once with the verifier and redirect', async () => {
    const s = start(); const f = fetchOk();
    const t = await pkceComplete(`centcom://auth/callback?code=abc&state=${s.state}`, { ...s, clientId: 'centcom-cli', http: httpWith(f) });
    expect(t.refreshToken).toBe('rt_pk'); expect(f).toHaveBeenCalledTimes(1);
    const body = JSON.parse(new TextDecoder().decode((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as Uint8Array));
    expect(body).toEqual({ grant_type: 'authorization_code', code: 'abc', code_verifier: s.verifier, redirect_uri: 'centcom://auth/callback', client_id: 'centcom-cli' });
  });
  it('a different state (same or other length) is rejected before any network call', async () => {
    const s = start(); const f = fetchOk(); const pending = { ...s, clientId: 'centcom-cli', http: httpWith(f) };
    const flipped = s.state.slice(0, -1) + (s.state.endsWith('A') ? 'B' : 'A');
    for (const st of [flipped, 'short', '', `${s.state}x`]) { const e = await pkceComplete(`centcom://auth/callback?code=abc&state=${st}`, pending).catch((x: unknown) => x); expect(e).toBeInstanceOf(PkceCallbackError); expect((e as PkceCallbackError).reason).toBe('state_mismatch'); }
    await expect(pkceComplete(`centcom://auth/callback?code=abc&state=${s.state}&state=${s.state}`, pending)).rejects.toMatchObject({ reason: 'state_mismatch' });
    expect(f).not.toHaveBeenCalled();
  });
  it('another redirect, a fragment, an error or a missing code is rejected before any network call', async () => {
    const s = start(); const f = fetchOk(); const pending = { ...s, clientId: 'centcom-cli', http: httpWith(f) };
    for (const [url, reason] of [[`centcom://evil/callback?code=a&state=${s.state}`, 'redirect_mismatch'], [`https://app.centcom.dev/auth/callback?code=a&state=${s.state}`, 'redirect_mismatch'], [`centcom://auth/callback/x?code=a&state=${s.state}`, 'redirect_mismatch'], [`centcom://auth/callback?code=a&state=${s.state}#access_token=x`, 'redirect_mismatch'], ['not a url', 'redirect_mismatch'], [`centcom://auth/callback?error=access_denied&state=${s.state}`, 'server_error'], [`centcom://auth/callback?state=${s.state}`, 'missing_code'], [`centcom://auth/callback?code=a&code=b&state=${s.state}`, 'missing_code']] as const) {
      await expect(pkceComplete(url, pending)).rejects.toMatchObject({ reason });
    }
    expect(f).not.toHaveBeenCalled();
  });
  it('a code cannot be replayed: the second completion of one start is refused without a request', async () => {
    const s = start(); const f = fetchOk(); const pending = { ...s, clientId: 'centcom-cli', http: httpWith(f) }; const url = `centcom://auth/callback?code=abc&state=${s.state}`;
    await pkceComplete(url, pending); await expect(pkceComplete(url, pending)).rejects.toMatchObject({ reason: 'replayed' }); expect(f).toHaveBeenCalledTimes(1);
  });
  it('works end to end against the mock token endpoint', async () => {
    const t = await authMock(); m = t.m; const s = pkceStart({ redirectUri: DESKTOP_REDIRECT_URI, clientId: 'centcom-cli', scopes: 'profile', baseUrl: t.m.url });
    const tok = await pkceComplete(`centcom://auth/callback?code=one-time&state=${s.state}`, { ...s, clientId: 'centcom-cli', http: t.http });
    expect(tok.deviceId).toMatch(/^dev_/); expect(t.seen.at(-1)!.body).toMatchObject({ grant_type: 'authorization_code', code_verifier: s.verifier });
  });
  it('constantTimeEqual agrees with === on any strings', () => {
    fc.assert(fc.property(fc.string(), fc.string(), (a, b) => constantTimeEqual(a, b) === (a === b))); expect(constantTimeEqual('abc', 'abc')).toBe(true);
  });
});
