import { describe, expect, it } from 'vitest';
import { AUTH_KEYCHAIN_SERVICE, KEYCHAIN_REMEDIATION, KeychainUnavailableError, createKeychainApiKeyStore, createKeychainTokenStore, memoryKeychain, osAuthKeychain, type Keychain } from '../../src/index.js';
import { DEV } from './helpers.js';

const A = { refreshToken: 'rt_opaque_refresh_value', deviceId: DEV, apiHost: 'api.centcom.dev' };
const down: Keychain = { get: async () => { throw new Error('no secret service'); }, set: async () => { throw new Error('locked'); }, delete: async () => { throw new Error('locked'); } };

/** A fake @napi-rs/keyring module over a Map. */
function fakeModule(o: { failGet?: boolean } = {}) {
  const store = new Map<string, string>(); const made: [string, string][] = [];
  class Entry { constructor(private s: string, private a: string) { made.push([s, a]); } getPassword() { if (o.failGet) throw new Error('locked'); return store.get(`${this.s}/${this.a}`) ?? null; } setPassword(p: string) { store.set(`${this.s}/${this.a}`, p); } deletePassword() { return store.delete(`${this.s}/${this.a}`); } }
  return { mod: { Entry }, store, made };
}

describe('KeychainTokenStore with the in-memory fake', () => {
  it('round-trips under service-agnostic account refresh:<api-host>, with no access token in it', async () => {
    const kc = memoryKeychain(); const s = createKeychainTokenStore('API.centcom.dev', { keychain: kc });
    expect(await s.load()).toBeNull(); await s.save(A); expect(await s.load()).toEqual(A);
    expect([...kc.entries.keys()]).toEqual(['refresh:api.centcom.dev']); expect(JSON.parse(kc.entries.get('refresh:api.centcom.dev')!)).toEqual({ v: 1, refresh_token: A.refreshToken, device_id: DEV, api_host: 'api.centcom.dev' });
    await s.clear(); expect(await s.load()).toBeNull(); expect(kc.entries.size).toBe(0);
  });
  it('stores for different hosts do not see each other; saving for another host is refused', async () => {
    const kc = memoryKeychain(); const a = createKeychainTokenStore('api.centcom.dev', { keychain: kc }); const b = createKeychainTokenStore('127.0.0.1:4000', { keychain: kc });
    await a.save(A); expect(await b.load()).toBeNull(); await expect(b.save(A)).rejects.toBeInstanceOf(TypeError);
  });
  it('a malformed or foreign entry reads as signed out', async () => {
    const kc = memoryKeychain(); const s = createKeychainTokenStore('api.centcom.dev', { keychain: kc });
    for (const v of ['not json', '{}', JSON.stringify({ v: 2, refresh_token: 'x', device_id: DEV, api_host: 'api.centcom.dev' }), JSON.stringify({ v: 1, refresh_token: 'x', device_id: 'nope', api_host: 'api.centcom.dev' }), JSON.stringify({ v: 1, refresh_token: 'x', device_id: DEV, api_host: 'evil.example' }), 'x'.repeat(9000)]) { kc.entries.set('refresh:api.centcom.dev', v); expect(await s.load()).toBeNull(); }
  });
  it('refuses to save values that are not a refresh token and a dev_ id, and bad hosts', async () => {
    const s = createKeychainTokenStore('api.centcom.dev', { keychain: memoryKeychain() });
    await expect(s.save({ ...A, refreshToken: 'two words' })).rejects.toBeInstanceOf(TypeError); await expect(s.save({ ...A, deviceId: 'usr_x' })).rejects.toBeInstanceOf(TypeError);
    expect(() => createKeychainTokenStore('', { keychain: memoryKeychain() })).toThrow(TypeError); expect(() => createKeychainTokenStore('a/b', { keychain: memoryKeychain() })).toThrow(TypeError);
  });
  it('an unavailable keyring raises KeychainUnavailableError (with remediation) on load, save and clear', async () => {
    const s = createKeychainTokenStore('api.centcom.dev', { keychain: down });
    for (const p of [s.load(), s.save(A), s.clear()]) { const e = await p.catch((x: unknown) => x); expect(e).toBeInstanceOf(KeychainUnavailableError); expect((e as KeychainUnavailableError).remediation).toBe(KEYCHAIN_REMEDIATION); expect(String((e as Error).message)).not.toContain(A.refreshToken); }
  });
  it('the API key store checks the cen_ format and lives under apikey:<host>', async () => {
    const kc = memoryKeychain(); const k = createKeychainApiKeyStore('api.centcom.dev', { keychain: kc }); const key = `cen_live_${'Ab3k'.repeat(8)}`;
    await expect(k.save('cen_live_short')).rejects.toBeInstanceOf(TypeError); await k.save(key); expect(kc.entries.get('apikey:api.centcom.dev')).toBe(key); expect(await k.load()).toBe(key);
    kc.entries.set('apikey:api.centcom.dev', 'garbage'); expect(await k.load()).toBeNull(); await k.clear(); expect(kc.entries.size).toBe(0);
    await expect(createKeychainApiKeyStore('h', { keychain: down }).load()).rejects.toBeInstanceOf(KeychainUnavailableError);
  });
});

describe('osAuthKeychain', () => {
  it('uses service "centcom" and round-trips through the keyring module', async () => {
    const f = fakeModule(); const kc = osAuthKeychain(undefined, async () => f.mod);
    await kc.set('refresh:h', 'v'); expect(await kc.get('refresh:h')).toBe('v'); await kc.delete('refresh:h'); expect(await kc.get('refresh:h')).toBeUndefined();
    expect(f.made.every(([s]) => s === AUTH_KEYCHAIN_SERVICE)).toBe(true); expect(AUTH_KEYCHAIN_SERVICE).toBe('centcom');
  });
  it('a module that cannot load, or a read that fails, is KeychainUnavailableError (never "signed out")', async () => {
    const missing = osAuthKeychain('centcom', async () => { throw new Error('Cannot find module'); });
    await expect(missing.get('a')).rejects.toBeInstanceOf(KeychainUnavailableError); await expect(missing.set('a', 'b')).rejects.toBeInstanceOf(KeychainUnavailableError);
    const locked = osAuthKeychain('centcom', async () => fakeModule({ failGet: true }).mod); await expect(locked.get('a')).rejects.toBeInstanceOf(KeychainUnavailableError);
  });
});

/* Opt-in: the real OS keychain (needs a desktop session or a Secret Service). */
describe.runIf(process.env.CENTCOM_TEST_KEYCHAIN === '1')('real keyring (CENTCOM_TEST_KEYCHAIN=1)', () => {
  it('round-trips a refresh token and clears it', async () => {
    const s = createKeychainTokenStore(`test-${process.pid}.centcom.invalid`); const a = { ...A, apiHost: `test-${process.pid}.centcom.invalid` };
    try { await s.save(a); expect(await s.load()).toEqual(a); } finally { await s.clear(); }
    expect(await s.load()).toBeNull();
  });
});
