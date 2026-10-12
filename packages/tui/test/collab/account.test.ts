import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startMockBackend, type MockBackend } from '@centcom/testkit';
import { Account } from '../../src/collab/account.js';

const instant = { now: () => Date.now(), setTimeout: (f: () => void) => { const h = setImmediate(f); return h as never; }, clearTimeout: (h: never) => clearImmediate(h as never) } as never;
let m: MockBackend | undefined; afterEach(async () => { await m?.stop(); m = undefined; });
const make = async () => { m = await startMockBackend({ seed: 11 }); return Account.create({ app: 'centcom-tui', version: '0.1.0', baseUrl: m.url, keychain: 'memory', clock: instant, stateDir: mkdtempSync(join(tmpdir(), 'acct-')) }); };

describe('the account', () => {
  it('is signed out until the device sign-in is approved, then knows who signed in, and signs out', async () => {
    const a = await make(); expect((await a.status()).signedIn).toBe(false);
    const login = await a.beginLogin(); expect(login.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/); expect(login.verificationUriComplete).toContain(login.userCode);
    await m!.control('approve-device', { user_code: login.userCode }); const st = await login.wait();
    expect(st.signedIn).toBe(true); expect(st.me?.email).toContain('@'); expect(st.me?.plan).toBeTruthy(); expect(st.api).toBe(m!.url);
    expect((await a.status()).signedIn).toBe(true);
    await a.logout(); expect((await a.status()).signedIn).toBe(false);
  });
  it('a denied sign-in rejects and leaves the person signed out', async () => {
    const a = await make(); const login = await a.beginLogin(); await m!.control('deny-device', { user_code: login.userCode });
    await expect(login.wait()).rejects.toThrow(); expect((await a.status()).signedIn).toBe(false);
  });
  it('sharing needs a sign-in: asking for the session client while signed out says so', async () => {
    const a = await make(); await expect(a.sessions()).rejects.toMatchObject({ code: 'not_signed_in' });
  });
  it('once signed in it lists workspaces and gives a session client for this device', async () => {
    const a = await make(); const login = await a.beginLogin(); await m!.control('approve-device', { user_code: login.userCode }); await login.wait();
    expect(Array.isArray(await a.workspaces())).toBe(true); const s = await a.sessions(); expect(typeof s.createSession).toBe('function'); expect(await a.sessions()).toBe(s);
  });
});
