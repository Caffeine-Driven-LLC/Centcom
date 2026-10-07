import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { MockBackend } from '@centcom/testkit';
import { AuthRequiredError, KeychainUnavailableError, TokenManager, TransportError, createHttpClient, createKeychainApiKeyStore, createKeychainTokenStore, decodeAccessClaims, memoryKeychain, memoryTokenStore, startDeviceLogin, type StoredAuth, type TokenStore } from '../../src/index.js';
import { AutoClock, NO_TIMEOUT, UA, json, problem } from '../http/helpers.js';
import { DEV, USR, authMock, fakeJwt, fixedKeys, mockSignIn, recordingFetch, tokenBody, type Rec } from './helpers.js';

let m: MockBackend | undefined; afterEach(async () => { await m?.stop(); m = undefined; });
const dirs: string[] = []; afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'centcom-auth-')); dirs.push(d); return d; };
const refreshes = (seen: Rec[]) => seen.filter((r) => r.path === '/v1/auth/token' && r.body?.grant_type === 'refresh_token');
const familyCurrent = (mk: MockBackend) => [...mk.state.families.values()].map((f) => f.current);

/** A signed-in TokenManager on the mock, with a store that records the order of saves. */
async function signedIn(o: { lockDir?: string; store?: TokenStore & { current?(): StoredAuth | null } } = {}) {
  const t = await authMock(); m = t.m; const order: string[] = [];
  const base = o.store ?? memoryTokenStore();
  const store: TokenStore = { load: () => base.load(), save: async (a) => { order.push(`save:${a.refreshToken}`); await base.save(a); }, clear: () => base.clear() };
  const tm = new TokenManager({ http: t.http, store, clock: t.clock, lockDir: o.lockDir ?? tmp() });
  const tokens = await mockSignIn(t.m, t.http); await tm.adopt(tokens, t.host); order.length = 0;
  return { ...t, tm, store, base, order, tokens };
}

describe('single flight and rotation (acceptance 6)', () => {
  it('ten concurrent calls with an expired token make one refresh; the rotated token is saved before the first caller resolves', async () => {
    const s = await signedIn(); await s.m.advance(16 * 60_000);
    const before = refreshes(s.seen).length;
    const all = Array.from({ length: 10 }, () => s.tm.getAccessToken().then((tok) => { s.order.push('resolved'); return tok; }));
    const toks = await Promise.all(all);
    expect(refreshes(s.seen).length - before).toBe(1);
    expect(new Set(toks).size).toBe(1); expect(toks[0]).not.toBe(s.tokens.accessToken);
    expect(s.order[0]).toMatch(/^save:/); expect(s.order.slice(1).every((x) => x === 'resolved')).toBe(true);
    const saved = (await s.store.load())!; expect(familyCurrent(s.m)).toContain(saved.refreshToken); expect(saved.refreshToken).not.toBe(s.tokens.refreshToken);
    const authed = s.http.withAuthProvider(s.tm.authProvider()); expect((await authed.call('getMe', {})).status).toBe(200);
  });
  it('a 401 token_expired from the API (our clock is behind) forces one refresh through the HTTP client hook, then the call succeeds', async () => {
    const t = await authMock(); m = t.m; const store = memoryTokenStore(); let skew = 0;
    const tm = new TokenManager({ http: t.http, store, clock: { now: () => t.m.clock.now() - skew, setTimeout: t.clock.setTimeout.bind(t.clock), clearTimeout: t.clock.clearTimeout.bind(t.clock) }, lockDir: tmp() });
    await tm.adopt(await mockSignIn(t.m, t.http), t.host); const authed = t.http.withAuthProvider(tm.authProvider());
    await t.m.advance(16 * 60_000); skew = 16 * 60_000; /* the server says expired; we think 15 minutes are left */
    const before = refreshes(t.seen).length; expect((await authed.call('getMe', {})).status).toBe(200); expect(refreshes(t.seen).length - before).toBe(1);
    const me = t.seen.filter((r) => r.path === '/v1/me'); expect(me.map((r) => r.status)).toEqual([401, 200]);
  });
});

describe('two processes (acceptance 7)', () => {
  it('two managers sharing a lock dir and a store send each refresh token once: the second re-reads the rotated token after the lock (no reuse detection)', async () => {
    const lockDir = tmp(); const shared = memoryTokenStore();
    const s = await signedIn({ lockDir, store: shared });
    const other = new TokenManager({ http: s.http, store: shared, clock: s.clock, lockDir });
    await s.m.advance(16 * 60_000); const before = refreshes(s.seen).length;
    const [a, b] = await Promise.all([s.tm.getAccessToken(), other.getAccessToken()]);
    const sent = refreshes(s.seen).slice(before);
    expect(sent.every((r) => r.status === 200)).toBe(true);
    const used = sent.map((r) => r.body!.refresh_token); expect(new Set(used).size).toBe(used.length); /* no token sent twice */
    expect(used[0]).toBe(s.tokens.refreshToken);
    expect(sent).toHaveLength(2); /* access tokens live in memory only, so the second process needs its own; see README "Known gaps" */
    expect(used[1]).toBe(JSON.parse(sent[0]!.response!).refresh_token); /* read from the store after the lock */
    expect(a).toBeTruthy(); expect(b).toBeTruthy(); expect(familyCurrent(s.m)).toContain(shared.current()!.refreshToken);
    expect([...s.m.state.families.values()].every((f) => !f.revoked)).toBe(true);
    expect(existsSync(join(lockDir, 'auth-refresh.lock'))).toBe(false);
  });
});

describe('terminal refresh errors and offline (acceptance 8)', () => {
  it('refresh_reuse_detected clears the store, emits auth-required once, then throws AuthRequiredError without further requests', async () => {
    const s = await signedIn(); const events: unknown[] = []; s.tm.on('auth-required', (p) => events.push(p));
    await s.http.call('issueToken', { body: { grant_type: 'refresh_token', refresh_token: s.tokens.refreshToken, client_id: 'centcom-cli' } }); /* someone used our token: the stored one is now spent */
    await s.m.advance(16 * 60_000); const before = s.seen.length;
    await expect(s.tm.getAccessToken()).rejects.toMatchObject({ name: 'AuthRequiredError', reason: 'refresh_reuse_detected' });
    expect(await s.store.load()).toBeNull(); expect(s.seen.length - before).toBe(1);
    await expect(s.tm.getAccessToken()).rejects.toBeInstanceOf(AuthRequiredError); await expect(s.tm.forceRefresh()).rejects.toBeInstanceOf(AuthRequiredError);
    expect(s.seen.length - before).toBe(1); expect(events).toEqual([{ reason: 'refresh_reuse_detected' }]);
  });
  for (const code of ['token_revoked', 'token_invalid', 'device_revoked', 'invalid_grant']) {
    it(`${code} ends the sign-in the same way`, async () => {
      const s = await signedIn(); const fn = vi.fn(); s.tm.on('auth-required', fn);
      await s.m.advance(16 * 60_000); await s.m.control('errors', { code });
      await expect(s.tm.getAccessToken()).rejects.toBeInstanceOf(AuthRequiredError); expect(await s.store.load()).toBeNull(); expect(fn).toHaveBeenCalledTimes(1);
      const n = s.seen.length; await expect(s.tm.getAccessToken()).rejects.toBeInstanceOf(AuthRequiredError); expect(s.seen.length).toBe(n);
    });
  }
  it('a revoked device is refused on refresh (real mock state, not an injected error)', async () => {
    const s = await signedIn(); await s.m.control('revoke-device', { device: s.tokens.deviceId }); await s.m.advance(16 * 60_000);
    await expect(s.tm.getAccessToken()).rejects.toMatchObject({ reason: 'device_revoked' });
  });
  it('a network error during refresh keeps the stored token and the next call tries again', async () => {
    const s = await signedIn(); await s.m.advance(16 * 60_000); const kept = (await s.store.load())!;
    s.ctl.offline = true; await expect(s.tm.getAccessToken()).rejects.toBeInstanceOf(TransportError);
    expect(await s.store.load()).toEqual(kept);
    s.ctl.offline = false; const before = refreshes(s.seen).length; await expect(s.tm.getAccessToken()).resolves.toBeTruthy(); expect(refreshes(s.seen).length - before).toBe(1);
  });
  it('a server error during refresh also keeps the token', async () => {
    const s = await signedIn(); await s.m.advance(16 * 60_000); const kept = (await s.store.load())!;
    await s.m.control('errors', { code: 'internal_error' }); await expect(s.tm.getAccessToken()).rejects.toMatchObject({ code: 'internal_error' }); expect(await s.store.load()).toEqual(kept);
  });
});

/** A manager over a scripted token endpoint, with a clock we set by hand. */
function scriptedManager(answers: (() => Response)[], stored: StoredAuth | null = { refreshToken: 'rt_0', deviceId: DEV, apiHost: 'api.centcom.dev' }) {
  const clock = { t: Date.UTC(2026, 9, 6, 12), now() { return this.t; }, setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: never) => clearTimeout(h) };
  let n = 0; const r = recordingFetch(undefined, { time: () => clock.t, override: () => answers[Math.min(n++, answers.length - 1)]!() });
  const http = createHttpClient({ getAccessToken: async () => undefined, baseUrl: 'https://api.centcom.dev', userAgent: UA, fetch: r.fetch, clock: new AutoClock(), timeoutMs: NO_TIMEOUT });
  const store = memoryTokenStore(stored); const tm = new TokenManager({ http, store, clock, lockDir: tmp() });
  return { tm, store, clock, seen: r.seen };
}

describe('early refresh window (acceptance 9)', () => {
  it('61 s left: returned without a request; 59 s left: refreshed', async () => {
    const s = scriptedManager([() => json(200, tokenBody(fakeJwt({ exp: Date.UTC(2026, 9, 6, 12, 15) / 1000, dev: DEV }), 'rt_1'))]);
    const now = s.clock.t / 1000; const access = fakeJwt({ exp: now + 61, dev: DEV, sub: USR });
    await s.tm.adopt({ accessToken: access, refreshToken: 'rt_0', expiresInS: 61, scope: 'profile', deviceId: DEV }, 'api.centcom.dev');
    expect(await s.tm.getAccessToken()).toBe(access); expect(s.seen).toHaveLength(0);
    s.clock.t += 1_000; expect(await s.tm.getAccessToken()).toBe(access); expect(s.seen).toHaveLength(0); /* exactly 60 s left */
    s.clock.t += 1_000; expect(await s.tm.getAccessToken()).not.toBe(access); expect(s.seen).toHaveLength(1); expect(s.seen[0]!.body).toEqual({ grant_type: 'refresh_token', refresh_token: 'rt_0', client_id: 'centcom-cli' });
    expect(s.store.current()!.refreshToken).toBe('rt_1');
  });
  it('a token whose expires_in is shorter than its exp claim is refreshed by expires_in', async () => {
    const s = scriptedManager([() => json(200, tokenBody(fakeJwt({ exp: 2_000_000_000 }), 'rt_1'))]);
    await s.tm.adopt({ accessToken: fakeJwt({ exp: s.clock.t / 1000 + 3600 }), refreshToken: 'rt_0', expiresInS: 30, scope: 'profile', deviceId: DEV }, 'api.centcom.dev');
    await s.tm.getAccessToken(); expect(s.seen).toHaveLength(1);
  });
});

describe('events, claims, principals', () => {
  it('ent-changed fires when the ent claim changes, not on the first token; refreshed fires on each refresh', async () => {
    const exp = Date.UTC(2026, 9, 6, 12, 15) / 1000;
    const s = scriptedManager([() => json(200, tokenBody(fakeJwt({ exp, ent: 1 }), 'rt_1')), () => json(200, tokenBody(fakeJwt({ exp, ent: 1 }), 'rt_2')), () => json(200, tokenBody(fakeJwt({ exp, ent: 4 }), 'rt_3'))]);
    const ent = vi.fn(); const refreshed = vi.fn(); const off = s.tm.on('ent-changed', ent); s.tm.on('refreshed', refreshed);
    await s.tm.forceRefresh(); await s.tm.forceRefresh(); expect(ent).not.toHaveBeenCalled();
    await s.tm.forceRefresh(); expect(ent).toHaveBeenCalledWith({ previous: 1, current: 4 }); expect(refreshed).toHaveBeenCalledTimes(3);
    off(); expect(s.tm.claims()).toMatchObject({ exp, ent: 4 });
  });
  it('decodeAccessClaims reads only well-typed claims and never throws', () => {
    expect(decodeAccessClaims(fakeJwt({ exp: 5, sub: USR, dev: DEV, wsp: 'wsp_01JA3Z8K2M5N7P9Q0R1S2T3V4W', plan: 'pro', ent: 3, scp: 'profile' }))).toEqual({ exp: 5, sub: USR, dev: DEV, wsp: 'wsp_01JA3Z8K2M5N7P9Q0R1S2T3V4W', plan: 'pro', ent: 3, scp: 'profile' });
    expect(decodeAccessClaims(fakeJwt({ exp: 5, sub: 'nope', dev: 7, ent: 1.5 }))).toEqual({ exp: 5 });
    for (const bad of ['', 'a.b', 'a.b.c', fakeJwt({ sub: USR }), fakeJwt({ exp: '5' }), `x.${Buffer.from('[1]').toString('base64url')}.y`, 'x'.repeat(20_000)]) expect(decodeAccessClaims(bad)).toBeNull();
  });
  it('constructing a manager does no I/O; a missing sign-in is AuthRequiredError with no lock and no request', async () => {
    const store = { load: vi.fn(async () => null), save: vi.fn(), clear: vi.fn() }; const lockDir = join(tmp(), 'locks'); const fetchSpy = vi.fn();
    const http = createHttpClient({ getAccessToken: async () => undefined, baseUrl: 'https://api.centcom.dev', userAgent: UA, fetch: fetchSpy as never });
    const tm = new TokenManager({ http, store, clock: new AutoClock(), lockDir });
    expect(store.load).not.toHaveBeenCalled(); expect(existsSync(lockDir)).toBe(false); expect(tm.claims()).toBeNull();
    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(AuthRequiredError); expect(fetchSpy).not.toHaveBeenCalled(); expect(existsSync(lockDir)).toBe(false);
    expect(await tm.status()).toEqual({ signedIn: false, principal: null, persisted: true, keychain: 'ok' });
  });
  it('an API key is the bearer when stored; it is checked locally and logout removes it', async () => {
    const kc = memoryKeychain(); const apiKeys = createKeychainApiKeyStore('api.centcom.dev', { keychain: kc }); const key = `cen_test_${'a1B2'.repeat(8)}`;
    const tm = new TokenManager({ http: createHttpClient({ getAccessToken: async () => undefined, baseUrl: 'https://api.centcom.dev', userAgent: UA, fetch: vi.fn() as never }), store: memoryTokenStore(), clock: new AutoClock(), lockDir: tmp(), apiKeys });
    await expect(tm.useApiKey('cen_live_short')).rejects.toBeInstanceOf(TypeError); expect(kc.entries.size).toBe(0);
    expect(await tm.useApiKey(key)).toEqual({ persisted: true }); expect(kc.entries.get('apikey:api.centcom.dev')).toBe(key);
    expect(await tm.getAccessToken()).toBe(key); expect(await tm.status()).toMatchObject({ signedIn: true, principal: 'api_key', persisted: true });
    await tm.forceRefresh(); /* nothing to refresh for a key */
    expect(await tm.logout()).toEqual({ serverRevoked: false, principal: 'api_key' }); expect(kc.entries.size).toBe(0); await expect(tm.getAccessToken()).rejects.toBeInstanceOf(AuthRequiredError);
  });
  it('without an API key store useApiKey is refused', async () => {
    const tm = new TokenManager({ http: createHttpClient({ getAccessToken: async () => undefined, baseUrl: 'https://api.centcom.dev', userAgent: UA }), store: memoryTokenStore(), clock: new AutoClock(), lockDir: tmp() });
    await expect(tm.useApiKey(`cen_live_${'x'.repeat(32)}`)).rejects.toBeInstanceOf(TypeError);
  });
});

describe('keychain unavailable', () => {
  const broken: TokenStore = { load: async () => { throw new KeychainUnavailableError(); }, save: async () => { throw new KeychainUnavailableError(); }, clear: async () => { throw new KeychainUnavailableError(); } };
  it('login completes in memory only (persisted: false); refresh then works without the lock or the keychain', async () => {
    const s = scriptedManager([() => json(200, tokenBody(fakeJwt({ exp: 2_000_000_000 }), 'rt_1'))]);
    const tm = new TokenManager({ http: createHttpClient({ getAccessToken: async () => undefined, baseUrl: 'https://api.centcom.dev', userAgent: UA, fetch: async () => json(200, tokenBody(fakeJwt({ exp: 2_000_000_000 }), 'rt_2')), clock: new AutoClock(), timeoutMs: NO_TIMEOUT }), store: broken, clock: s.clock, lockDir: join(tmp(), 'never') });
    const r = await tm.adopt({ accessToken: fakeJwt({ exp: s.clock.t / 1000 + 10 }), refreshToken: 'rt_0', expiresInS: 10, scope: 'profile', deviceId: DEV }, 'api.centcom.dev');
    expect(r).toEqual({ persisted: false }); expect(await tm.status()).toMatchObject({ signedIn: true, principal: 'device', persisted: false, keychain: 'unavailable' });
    expect(await tm.getAccessToken()).toBeTruthy();
    expect(await tm.logout().catch((e: unknown) => e)).toBeInstanceOf(KeychainUnavailableError); await expect(tm.getAccessToken()).rejects.toBeInstanceOf(AuthRequiredError);
  });
  it('an unreadable keychain reads as signed out (and says so in status)', async () => {
    const tm = new TokenManager({ http: createHttpClient({ getAccessToken: async () => undefined, baseUrl: 'https://api.centcom.dev', userAgent: UA }), store: broken, clock: new AutoClock(), lockDir: tmp() });
    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(AuthRequiredError); expect(await tm.status()).toMatchObject({ signedIn: false, keychain: 'unavailable' });
  });
  it('a refresh whose rotated token cannot be stored keeps it in memory, never drops it', async () => {
    let saves = 0; const store = memoryTokenStore({ refreshToken: 'rt_0', deviceId: DEV, apiHost: 'api.centcom.dev' }); const flaky: TokenStore = { load: () => store.load(), save: async (a) => { if (saves++ > 0) throw new KeychainUnavailableError(); await store.save(a); }, clear: () => store.clear() };
    const answers = ['rt_1', 'rt_2']; let i = 0; const seen: string[] = [];
    const http = createHttpClient({ getAccessToken: async () => undefined, baseUrl: 'https://api.centcom.dev', userAgent: UA, clock: new AutoClock(), timeoutMs: NO_TIMEOUT, fetch: async (_u, init) => { seen.push(JSON.parse(new TextDecoder().decode(init!.body as Uint8Array)).refresh_token); return json(200, tokenBody(fakeJwt({ exp: 1 }), answers[i++]!)); } });
    const tm = new TokenManager({ http, store: flaky, clock: new AutoClock(), lockDir: tmp() });
    await tm.forceRefresh(); await tm.forceRefresh(); await tm.forceRefresh().catch(() => undefined);
    expect(seen).toEqual(['rt_0', 'rt_1', 'rt_2']); /* each rotated token was used next, even the one the keychain refused */
  });
});

describe('logout (acceptance 11)', () => {
  it('reachable: POST /v1/auth/revoke once with the refresh token, then store and memory cleared', async () => {
    const s = await signedIn(); const rt = (await s.store.load())!.refreshToken;
    expect(await s.tm.logout()).toEqual({ serverRevoked: true, principal: 'device' });
    const revokes = s.seen.filter((r) => r.path === '/v1/auth/revoke'); expect(revokes).toHaveLength(1); expect(revokes[0]!.body).toEqual({ token: rt, token_type_hint: 'refresh_token' }); expect(revokes[0]!.auth).toMatch(/^Bearer /);
    expect(await s.store.load()).toBeNull(); expect(s.tm.claims()).toBeNull(); await expect(s.tm.getAccessToken()).rejects.toBeInstanceOf(AuthRequiredError);
    expect([...s.m.state.families.values()].every((f) => f.revoked)).toBe(true);
  });
  it('unreachable: clears the keychain and resolves serverRevoked false', async () => {
    const s = await signedIn(); await s.m.stop(); m = undefined;
    expect(await s.tm.logout()).toEqual({ serverRevoked: false, principal: 'device' }); expect(await s.store.load()).toBeNull();
  });
  it('an expired access token is refreshed first and the newest refresh token is the one revoked', async () => {
    const s = await signedIn(); await s.m.advance(16 * 60_000);
    expect((await s.tm.logout()).serverRevoked).toBe(true);
    const rev = s.seen.find((r) => r.path === '/v1/auth/revoke')!; const lastRefresh = refreshes(s.seen).at(-1)!;
    expect(rev.body!.token).toBe(JSON.parse(lastRefresh.response!).refresh_token);
  });
  it('not signed in: nothing to revoke, nothing sent', async () => {
    const s = scriptedManager([() => problem(500, 'internal_error')], null);
    expect(await s.tm.logout()).toEqual({ serverRevoked: false, principal: null }); expect(s.seen).toHaveLength(0);
  });
});

describe('no plaintext token on disk (acceptance 5)', () => {
  it('after a full login and a refresh, the keychain holds the refresh token and no file under HOME or the config dir contains a token', async () => {
    const home = tmp(); const t = await authMock(); m = t.m; const kc = memoryKeychain();
    const store = createKeychainTokenStore(t.host, { keychain: kc });
    const tm = new TokenManager({ http: t.http, store, clock: t.clock, lockDir: join(home, '.centcom', 'locks') });
    const login = await startDeviceLogin({ http: t.http, deviceName: 'x', keys: fixedKeys, clock: t.clock });
    const tokens = await login.poll(); await tm.adopt(tokens, t.host);
    await t.m.advance(16 * 60_000); const access2 = await tm.getAccessToken();
    const secrets = [tokens.accessToken, tokens.refreshToken, access2, (await store.load())!.refreshToken, JSON.parse(t.seen.find((r) => r.path === '/v1/auth/device/code')!.response!).device_code as string];
    const entry = kc.entries.get(`refresh:${t.host}`)!; expect(entry).toContain((await store.load())!.refreshToken); expect(entry).not.toContain(tokens.accessToken); expect(entry).not.toContain(access2);
    expect([...kc.entries.keys()]).toEqual([`refresh:${t.host}`]);
    const files: string[] = []; const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } }; walk(home);
    for (const f of files) { const text = readFileSync(f, 'utf8'); for (const sec of secrets) expect(text).not.toContain(sec); }
  });
});
