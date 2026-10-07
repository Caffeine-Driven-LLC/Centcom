import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { MockBackend } from '@centcom/testkit';
import { DESKTOP_REDIRECT_URI, TokenManager, createHttpClient, createKeychainTokenStore, createLogger, memoryKeychain, pkceComplete, pkceStart, startDeviceLogin } from '../../src/index.js';
import { AutoClock, NO_TIMEOUT, UA } from '../http/helpers.js';
import { LinkedClock, fixedKeys, recordingFetch } from './helpers.js';
import { startMockBackend } from '@centcom/testkit';

let m: MockBackend | undefined; afterEach(async () => { await m?.stop(); m = undefined; });
const dirs: string[] = []; afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

describe('nothing secret reaches the logs', () => {
  it('a full device login, refreshes, a forced refresh, a PKCE exchange and a logout log no token, device code, verifier, code or key', async () => {
    m = await startMockBackend({ clock: 'virtual', seed: 5 }); const lines: string[] = [];
    const logger = createLogger({ level: 'trace', clock: () => m!.clock.now(), sinks: [{ write: (l) => { lines.push(l); } }] });
    const r = recordingFetch(m); const host = new URL(m.url).host; const clock = new LinkedClock(m);
    const http = createHttpClient({ getAccessToken: async () => undefined, baseUrl: m.url, userAgent: UA, fetch: r.fetch, clock: new AutoClock(), timeoutMs: NO_TIMEOUT, logger });
    const kc = memoryKeychain(); const dir = mkdtempSync(join(tmpdir(), 'centcom-log-')); dirs.push(dir);
    const tm = new TokenManager({ http, store: createKeychainTokenStore(host, { keychain: kc }), clock, lockDir: dir, logger });
    const login = await startDeviceLogin({ http, deviceName: 'x', keys: fixedKeys, clock, logger });
    await tm.adopt(await login.poll(), host);
    await m.advance(16 * 60_000); await tm.getAccessToken(); await tm.forceRefresh();
    await http.withAuthProvider(tm.authProvider()).call('getMe', {});
    await m.control('errors', { code: 'refresh_reuse_detected' }); await tm.forceRefresh().catch(() => undefined);
    const s = pkceStart({ redirectUri: DESKTOP_REDIRECT_URI, clientId: 'centcom-cli', scopes: 'profile', baseUrl: m.url });
    await pkceComplete(`centcom://auth/callback?code=one-time-code-value&state=${s.state}`, { ...s, clientId: 'centcom-cli', http });
    await pkceComplete(`centcom://auth/callback?code=x&state=wrong`, { ...s, clientId: 'centcom-cli', http }).catch(() => undefined);
    await tm.logout();

    const secrets = new Set<string>([s.verifier, s.state, 'one-time-code-value', ...[...kc.entries.values()]]);
    for (const rec of r.seen) {
      const b = JSON.parse(rec.response || '{}') as Record<string, unknown>;
      for (const k of ['access_token', 'refresh_token', 'device_code']) if (typeof b[k] === 'string') secrets.add(b[k] as string);
      for (const k of ['refresh_token', 'device_code', 'code', 'code_verifier', 'token']) if (typeof rec.body?.[k] === 'string') secrets.add(rec.body[k] as string);
      if (rec.auth) secrets.add(rec.auth.replace(/^Bearer /, ''));
    }
    expect(secrets.size).toBeGreaterThan(8); expect(lines.length).toBeGreaterThan(10);
    const all = lines.join('\n');
    for (const sec of secrets) { expect(all).not.toContain(sec); expect(all).not.toContain(sec.slice(0, 24)); }
    expect(all).toMatch(/auth\.device_flow\.approved/); expect(all).toMatch(/auth\.refreshed/); expect(all).toMatch(/auth\.refresh\.ended/); expect(all).toMatch(/auth\.signed_out/);
  });
});
