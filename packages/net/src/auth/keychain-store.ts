/** Where a sign-in is kept: the OS keychain only (service `centcom`, account `refresh:<api-host>`; API keys under `apikey:<api-host>`).
 *  Must not: fall back to a file, the config or the environment when the keychain is missing; log or throw a stored value; keep an access token. */
import { isId } from '@centcom/protocol';
import type { Keychain } from '../crypto/index.js';
import { KeychainUnavailableError } from './errors.js';

/** The keychain service name for sign-ins (CT-AUTH: refresh tokens only in the OS keychain). */
export const AUTH_KEYCHAIN_SERVICE = 'centcom';
/** CT-AUTH API key format. */
export const API_KEY_RE = /^cen_(live|test)_[A-Za-z0-9]{32}$/;
const MAX_VALUE = 8 * 1024;

/** One device sign-in. The access token is never part of it. */
export interface StoredAuth { refreshToken: string; deviceId: string; apiHost: string }
export interface TokenStore { load(): Promise<StoredAuth | null>; save(a: StoredAuth): Promise<void>; clear(): Promise<void> }
/** A machine principal's API key (`cen_live_` / `cen_test_`), kept the same way. */
export interface ApiKeyStore { load(): Promise<string | null>; save(key: string): Promise<void>; clear(): Promise<void> }

type EntryCtor = new (service: string, account: string) => { getPassword(): string | null; setPassword(p: string): void; deletePassword(): boolean };

/** The OS keychain through @napi-rs/keyring (loaded on first use). Unlike a lenient wrapper, every failure, a read included, is a KeychainUnavailableError: a locked keychain must not look like "signed out". */
export function osAuthKeychain(service = AUTH_KEYCHAIN_SERVICE, load: () => Promise<{ Entry: EntryCtor }> = () => import('@napi-rs/keyring') as Promise<{ Entry: EntryCtor }>): Keychain {
  let mod: Promise<{ Entry: EntryCtor }> | undefined;
  const entry = async (account: string) => {
    try { mod ??= load(); return new (await mod).Entry(service, account); } catch (e) { mod = undefined; throw new KeychainUnavailableError(e); }
  };
  const guard = async <T>(f: () => T | Promise<T>): Promise<T> => { try { return await f(); } catch (e) { throw e instanceof KeychainUnavailableError ? e : new KeychainUnavailableError(e); } };
  return {
    get: (a) => guard(async () => (await entry(a)).getPassword() ?? undefined),
    set: (a, v) => guard(async () => { (await entry(a)).setPassword(v); }),
    delete: (a) => guard(async () => { (await entry(a)).deletePassword(); }),
  };
}

const wrap = async <T>(f: () => Promise<T>): Promise<T> => { try { return await f(); } catch (e) { throw e instanceof KeychainUnavailableError ? e : new KeychainUnavailableError(e); } };
const hostOf = (apiHost: string) => { const h = apiHost.trim().toLowerCase(); if (!h || h.length > 255 || /[\s/@]/.test(h)) throw new TypeError('apiHost must be a host name, optionally with a port'); return h; };

/** The refresh token store for one API host. `keychain` defaults to the OS keychain; tests pass `memoryKeychain()`. A malformed entry reads as signed out. */
export function createKeychainTokenStore(apiHost: string, o: { keychain?: Keychain } = {}): TokenStore {
  const host = hostOf(apiHost); const kc = o.keychain ?? osAuthKeychain(); const account = `refresh:${host}`;
  return {
    load: () => wrap(async () => {
      const raw = await kc.get(account); if (!raw || raw.length > MAX_VALUE) return null;
      let j: unknown; try { j = JSON.parse(raw); } catch { return null; }
      const r = j as { v?: unknown; refresh_token?: unknown; device_id?: unknown; api_host?: unknown };
      if (r?.v !== 1 || typeof r.refresh_token !== 'string' || !r.refresh_token || !isId('dev', r.device_id) || r.api_host !== host) return null;
      return { refreshToken: r.refresh_token, deviceId: r.device_id, apiHost: host };
    }),
    async save(a) {
      if (!a.refreshToken || /\s/.test(a.refreshToken) || a.refreshToken.length > 4096) throw new TypeError('refresh token is not a single opaque string');
      if (!isId('dev', a.deviceId)) throw new TypeError('deviceId must be a dev_ id');
      if (hostOf(a.apiHost) !== host) throw new TypeError('this store belongs to another API host');
      await wrap(() => kc.set(account, JSON.stringify({ v: 1, refresh_token: a.refreshToken, device_id: a.deviceId, api_host: host })));
    },
    clear: () => wrap(() => kc.delete(account)),
  };
}

/** The API key store for one API host. */
export function createKeychainApiKeyStore(apiHost: string, o: { keychain?: Keychain } = {}): ApiKeyStore {
  const kc = o.keychain ?? osAuthKeychain(); const account = `apikey:${hostOf(apiHost)}`;
  return {
    load: () => wrap(async () => { const k = await kc.get(account); return k && API_KEY_RE.test(k) ? k : null; }),
    async save(key) { if (!API_KEY_RE.test(key)) throw new TypeError('not a Centcom API key'); await wrap(() => kc.set(account, key)); },
    clear: () => wrap(() => kc.delete(account)),
  };
}

/** An in-memory TokenStore for tests and for a session that must not persist. */
export function memoryTokenStore(initial: StoredAuth | null = null): TokenStore & { current(): StoredAuth | null } {
  let cur = initial ? { ...initial } : null;
  return { load: async () => (cur ? { ...cur } : null), save: async (a) => { cur = { ...a }; }, clear: async () => { cur = null; }, current: () => cur };
}
