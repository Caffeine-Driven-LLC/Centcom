import { describe, expect, it } from 'vitest';
import { completeLogin, startLogin } from '../../src/auth/login.js';
import { ensureDeviceKeys, type KeyStore } from '../../src/auth/devicekeys.js';
import { refreshAccessToken } from '../../src/auth/refresh.js';
import { peekToken } from '../../src/auth/store.js';
import { deps, json, loginEnv } from './helpers.js';

describe('no token in any web storage (acceptance 3)', () => {
  it('after login and a refresh, session storage, local storage and the device key store hold no access or refresh token', async () => {
    const session = loginEnv(); const local = loginEnv().storage; const idbValues: unknown[] = []; const store: KeyStore = { get: async () => undefined, put: async (k) => void idbValues.push(k) };
    const d = deps(async (u) => json(200, { access_token: 'SECRET-ACCESS', refresh_token: 'SECRET-REFRESH', expires_in: 900 })); const url = new URL(await startLogin(d, session.env)); await completeLogin(new URL(`https://app.centcom.dev/auth/callback?code=C&state=${url.searchParams.get('state')}`), d, session.env); await refreshAccessToken(d); await ensureDeviceKeys(store);
    expect(peekToken().token).toBe('SECRET-ACCESS'); const everything = JSON.stringify([...session.storage.m, ...local.m]) + session.hist.join() + session.calls.join(); expect(everything).not.toContain('SECRET'); expect(JSON.stringify(idbValues)).not.toContain('SECRET'); expect(session.storage.m.size).toBe(0); expect(local.m.size).toBe(0);
  });
  it('the device keys are made non-extractable and only public halves leave; a browser without Ed25519 is viewer-only', async () => {
    let saved: unknown; const store: KeyStore = { get: async () => undefined, put: async (k) => { saved = k; } }; const r = await ensureDeviceKeys(store); expect(r.viewerOnly).toBe(false); expect(r.pubkeys!.ed25519).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(r.pubkeys!.x25519).toMatch(/^[A-Za-z0-9_-]{43}$/); const k = saved as { ed25519: CryptoKeyPair }; expect(k.ed25519.privateKey.extractable).toBe(false); await expect(crypto.subtle.exportKey('raw', k.ed25519.privateKey)).rejects.toThrow();
    const old = { generateKey: async () => { throw new Error('unsupported'); } } as unknown as SubtleCrypto; expect(await ensureDeviceKeys({ get: async () => undefined, put: async () => undefined }, old)).toEqual({ viewerOnly: true });
  });
});
