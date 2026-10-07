import { beforeEach, describe, expect, it } from 'vitest';
import { AuthError } from '../../shell/src/auth/errors.js';
import { completeLogin, startLogin } from '../../shell/src/auth/login.js';
import { peekToken, reset } from '../../shell/src/auth/store.js';
import { deps, fixedRandom, json, loginEnv } from './helpers.js';

beforeEach(reset);
const start = async (le = loginEnv(), returnTo = '/sessions') => { const d = deps(async () => json(200, { access_token: 'AT-1', token_type: 'Bearer', expires_in: 900, refresh_token: '', scope: 'x' })); const url = await startLogin(d, le.env, { returnTo }); return { le, d, url: new URL(url) }; };
describe('authorize URL (acceptance 1)', () => {
  it('has code, the web client, S256, a 43 character challenge and 256 bits of state; plain is never produced', async () => {
    const { url, le } = await start(); const q = url.searchParams; expect(url.origin + url.pathname).toBe('https://api.centcom.dev/v1/auth/authorize'); expect(q.get('response_type')).toBe('code'); expect(q.get('client_id')).toBe('centcom-web'); expect(q.get('code_challenge_method')).toBe('S256'); expect(q.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(q.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(q.get('redirect_uri')).toBe('https://app.centcom.dev/auth/callback'); expect(le.calls).toEqual([url.toString()]); expect(url.toString()).not.toContain('plain');
    const stored = JSON.parse(le.storage.m.get('centcom.pkce')!); expect(stored.verifier).toHaveLength(64); expect(q.get('code_challenge')).not.toBe(stored.verifier); expect(stored.returnTo).toBe('/sessions');
  });
  it('device public keys and a name travel on the authorize request, never private material; a bad returnTo becomes /', async () => {
    const le = loginEnv(); const d = deps(async () => json(200, {})); const url = new URL(await startLogin(d, le.env, { returnTo: '//evil', device: { pubkeys: { x25519: 'XK', ed25519: 'EK' }, name: 'Web browser' } })); expect(url.searchParams.get('device_name')).toBe('Web browser'); expect(atob(url.searchParams.get('device_pubkeys')!.replace(/-/g, '+').replace(/_/g, '/'))).toBe('{"x25519":"XK","ed25519":"EK"}'); expect(JSON.parse(le.storage.m.get('centcom.pkce')!).returnTo).toBe('/');
  });
});
describe('callback (acceptance 2, 3, 4)', () => {
  it('a valid callback trades the code once with the web header and credentials, keeps the token in memory, and cleans the address', async () => {
    const { le, d, url } = await start(); const state = url.searchParams.get('state')!; const cb = new URL(`https://app.centcom.dev/auth/callback?code=CODE1&state=${state}`);
    expect(await completeLogin(cb, d, le.env)).toEqual({ returnTo: '/sessions' }); const call = d.calls[0]!; expect(call.url).toBe('https://api.centcom.dev/v1/auth/token'); expect((call.init!.headers as Record<string, string>)['X-Centcom-Client']).toBe('web'); expect(call.init!.credentials).toBe('include'); const body = JSON.parse(String(call.init!.body)); expect(body).toMatchObject({ grant_type: 'authorization_code', code: 'CODE1', client_id: 'centcom-web' }); expect(body.code_verifier).toHaveLength(64); expect(body.refresh_token).toBeUndefined();
    expect(peekToken().token).toBe('AT-1'); expect(le.hist[0]).toBe('/auth/callback'); expect(le.hist.at(-1)).toBe('/sessions'); expect(le.hist.join()).not.toMatch(/code|state/); expect(le.storage.m.size).toBe(0);
  });
  it('a missing, wrong or replayed state aborts before the token endpoint and clears the pending login', async () => {
    for (const q of ['code=C', 'code=C&state=WRONG']) { const { le, d } = await start(); await expect(completeLogin(new URL(`https://app.centcom.dev/auth/callback?${q}`), d, le.env)).rejects.toMatchObject({ code: 'state_mismatch' }); expect(d.calls).toHaveLength(0); expect(le.storage.m.size).toBe(0); }
    const { le, d, url } = await start(); const cb = new URL(`https://app.centcom.dev/auth/callback?code=C&state=${url.searchParams.get('state')}`); await completeLogin(cb, d, le.env); await expect(completeLogin(cb, d, le.env)).rejects.toMatchObject({ code: 'no_pending_login' }); expect(d.calls).toHaveLength(1);
  });
  it('no pending login at all is refused; an error parameter is a neutral message with nothing from the URL', async () => {
    const le = loginEnv(); const d = deps(async () => json(200, {})); await expect(completeLogin(new URL('https://app.centcom.dev/auth/callback?code=C&state=S'), d, le.env)).rejects.toBeInstanceOf(AuthError);
    const s = await start(); const state = s.url.searchParams.get('state'); const err = await completeLogin(new URL(`https://app.centcom.dev/auth/callback?error=access_denied&error_description=%3Cimg%20src%3Dx%3E&state=${state}`), s.d, s.le.env).catch((e: AuthError) => e); expect(err).toMatchObject({ code: 'access_denied', message: 'Sign-in was cancelled.' }); expect(String((err as Error).message)).not.toContain('img'); expect(s.d.calls).toHaveLength(0);
  });
  it('a failed exchange gives a neutral error and leaves no token', async () => { const le = loginEnv(); const d = deps(async () => json(400, { code: 'invalid_grant' })); const url = new URL(await startLogin(d, le.env)); await expect(completeLogin(new URL(`https://app.centcom.dev/auth/callback?code=C&state=${url.searchParams.get('state')}`), d, le.env)).rejects.toMatchObject({ code: 'exchange_failed' }); expect(peekToken().token).toBeUndefined(); });
  it('the random source can be fixed for tests', async () => { const a = loginEnv(); const b = loginEnv(); const d = deps(async () => json(200, {})); a.env.random = fixedRandom(); b.env.random = fixedRandom(); expect(await startLogin(d, a.env)).toBe(await startLogin(d, b.env)); });
});
