import { afterEach, describe, expect, it } from 'vitest';
import { KeychainUnavailableError, memoryKeychain } from '@centcom/net';
import { MSG } from '../../src/commands/account/messages.js';
import { USER_CODE_RE, accountEnv, json, type Env } from './helpers.js';

let env: Env | undefined; afterEach(async () => { await env?.stop(); env = undefined; });
const codeOf = (lines: string[]) => /Code: (\S+)/.exec(lines.join('\n'))?.[1];
const ME = (plan: string) => ({ user: { id: 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V4W', email: 'k@example.test', display_name: 'Key Owner', locale: 'en', telemetry: false, created_at: '2026-10-06T12:00:00.000Z' }, plan, active_workspace: null, ent: 2 });

describe('device login (acceptance 1, 2)', () => {
  it('--no-browser prints an ABCD-EFGH code and the verification URL, never opens a browser, and exits 0 after approval', async () => {
    env = await accountEnv();
    const code = await env.run('login', '--no-browser');
    expect(code).toBe(0); expect(env.opener).not.toHaveBeenCalled();
    const userCode = codeOf(env.out)!; expect(userCode).toMatch(USER_CODE_RE);
    expect(env.out).toContain(`  https://centcom.dev/device?user_code=${userCode}`); expect(env.out.join('\n')).toContain('https://centcom.dev/device and enter');
    expect(env.out.at(-1)).toMatch(/^Signed in as Dev Tester <dev@example\.test> on the (Free|Pro|Team) plan\.$/);
    expect(env.kc.entries.get(`refresh:${env.host}`)).toBeTruthy();
    const dc = env.seen.find((r) => r.path === '/v1/auth/device/code')!; expect(dc.body).toMatchObject({ client_id: 'centcom-cli', device_name: 'test-host' });
  });
  it('without --no-browser the opener is called once with verification_uri_complete', async () => {
    env = await accountEnv();
    expect(await env.run('login', '--device-name', 'work laptop')).toBe(0);
    expect(env.opener).toHaveBeenCalledTimes(1); const url = env.opener.mock.calls[0]![0] as string;
    expect(url).toBe(`https://centcom.dev/device?user_code=${codeOf(env.out)}`); expect(env.out).toContain(MSG.login.browserOpened);
    expect(env.seen.find((r) => r.path === '/v1/auth/device/code')!.body).toMatchObject({ device_name: 'work laptop' });
  });
  it('an opener that fails still succeeds and the URL is printed', async () => {
    env = await accountEnv({ opener: async () => false });
    expect(await env.run('login')).toBe(0); expect(env.opener).toHaveBeenCalledTimes(1);
    expect(env.out).toContain(MSG.login.browserFailed); expect(env.out.some((l) => l.includes('https://centcom.dev/device?user_code='))).toBe(true);
  });
  it('a sign-in page that is not https is printed but never opened', async () => {
    env = await accountEnv({ override: (r) => (r.path === '/v1/auth/device/code' ? json(200, { device_code: 'dc_x', user_code: 'BCDF-GHJK', verification_uri: 'http://evil.example/device', verification_uri_complete: 'http://evil.example/device?user_code=BCDF-GHJK', expires_in: 6, interval: 5 }) : undefined) });
    expect(await env.run('login')).toBe(1); expect(env.opener).not.toHaveBeenCalled(); expect(env.out).toContain(MSG.login.browserRefused);
  });
  it('--json prints one JSON document on stdout; the instructions go to stderr', async () => {
    env = await accountEnv();
    expect(await env.run('login', '--no-browser', '--json')).toBe(0);
    expect(env.out).toHaveLength(1); const j = JSON.parse(env.out[0]!);
    expect(j).toMatchObject({ signed_in: true, principal: 'device', persisted: true, user: { display_name: 'Dev Tester', email: 'dev@example.test' } }); expect(j.device).toMatch(/^dev_/);
    expect(codeOf(env.err)).toMatch(USER_CODE_RE);
  });
  it('the device keys move to the new dev_ id when the provider can do that', async () => {
    env = await accountEnv(); const ids: string[] = []; (env.deps.keys as unknown as { rebindDeviceId(id: string): Promise<void> }).rebindDeviceId = async (id) => { ids.push(id); };
    expect(await env.run('login', '--no-browser')).toBe(0); expect(ids).toHaveLength(1); expect(ids[0]).toMatch(/^dev_/);
  });
});

describe('denied, expired, cancelled (acceptance 3)', () => {
  it('denied: exit 1 with the access_denied text', async () => {
    env = await accountEnv({ onOut: (l, e) => { const c = /Code: (\S+)/.exec(l)?.[1]; if (c) void e.m.control('deny-device', { user_code: c }); } });
    expect(await env.run('login', '--no-browser')).toBe(1); expect(env.err).toContain(MSG.login.denied); expect(env.kc.entries.size).toBe(0);
  });
  it('expired: exit 1 with a rerun hint', async () => {
    env = await accountEnv({ onOut: (l, e) => { if (l.startsWith('  Code:')) void e.m.control('expire-device', {}); } });
    expect(await env.run('login', '--no-browser')).toBe(1); expect(env.err).toContain(MSG.login.expired); expect(MSG.login.expired).toMatch(/centcom login again/);
  });
  it('Ctrl-C while polling aborts within 1 s, exits 1 and leaves the keychain unchanged', async () => {
    const kc = memoryKeychain(); kc.entries.set('unrelated', 'kept'); let abortedAt = 0;
    env = await accountEnv({ keychain: kc, onRequest: (r, e) => { if (r.path === '/v1/auth/token' && !abortedAt) setImmediate(() => { abortedAt = Date.now(); e.ac.abort(); }); } });
    const code = await env.run('login', '--no-browser'); const took = Date.now() - abortedAt;
    expect(env.seen.filter((r) => r.path === '/v1/auth/token')).toHaveLength(1); /* polling had started */
    expect(code).toBe(1); expect(took).toBeLessThan(1000); expect(env.err).toContain(MSG.login.cancelled);
    expect([...kc.entries.entries()]).toEqual([['unrelated', 'kept']]);
  });
  it('keychain unavailable: the login completes in memory, warns that it will not persist, exits 0', async () => {
    const down = Object.assign(memoryKeychain(), { set: async () => { throw new KeychainUnavailableError(); } });
    env = await accountEnv({ keychain: down });
    expect(await env.run('login', '--no-browser')).toBe(0); expect(env.err).toContain(MSG.login.notPersisted); expect(env.err).toContain(MSG.errors.keychain); expect(down.entries.size).toBe(0);
    expect(await env.tm.status()).toMatchObject({ signedIn: true, persisted: false });
  });
  it('the server unreachable at start: exit 1 with the offline line, no stack trace', async () => {
    env = await accountEnv(); env.ctl.offline = true;
    expect(await env.run('login', '--no-browser')).toBe(1); expect(env.err).toEqual([MSG.errors.offline]);
  });
  it('bad flags print the usage and exit 1 with no request', async () => {
    env = await accountEnv();
    expect(await env.run('login', '--nope')).toBe(1); expect(await env.run('login', '--device-name')).toBe(1); expect(await env.run('login', 'extra')).toBe(1);
    expect(env.err.filter((l) => l === MSG.usage.login)).toHaveLength(3); expect(env.seen).toHaveLength(0);
  });
});

describe('--api-key-stdin (acceptance 9)', () => {
  const KEY = `cen_test_${'Q7rT'.repeat(8)}`;
  const apiKeyServer = (plan = 'team') => (r: { path: string; auth?: string }) => (r.auth === `Bearer ${KEY}` && r.path === '/v1/me' ? json(200, ME(plan)) : undefined);
  it('reads one line, checks the format locally, stores it in the keychain, and then whoami works', async () => {
    env = await accountEnv({ stdin: `${KEY}\n`, override: apiKeyServer() });
    expect(await env.run('login', '--api-key-stdin')).toBe(0); expect(env.kc.entries.get(`apikey:${env.host}`)).toBe(KEY);
    expect(env.out.at(-1)).toBe(MSG.login.apiKeySignedIn('Key Owner', 'team'));
    env.out.length = 0; expect(await env.run('whoami', '--json')).toBe(0); expect(JSON.parse(env.out[0]!)).toMatchObject({ plan: 'team', user: { display_name: 'Key Owner' } });
    expect(env.seen.every((r) => r.auth === `Bearer ${KEY}`)).toBe(true);
  });
  it('a malformed key exits 1 before any network call and stores nothing', async () => {
    for (const bad of ['cen_live_short', `cen_prod_${'a'.repeat(32)}`, `cen_live_${'a'.repeat(31)}!`, '']) {
      env = await accountEnv({ stdin: bad }); expect(await env.run('login', '--api-key-stdin')).toBe(1); expect(env.seen).toHaveLength(0); expect(env.kc.entries.size).toBe(0);
      expect(env.err[0]).toBe(bad ? MSG.login.apiKeyMalformed : MSG.login.apiKeyMissing); await env.stop(); env = undefined;
    }
  });
  it('a key the server refuses is removed again and exits 1', async () => {
    env = await accountEnv({ stdin: KEY });
    expect(await env.run('login', '--api-key-stdin')).toBe(1); expect(env.err).toContain(MSG.login.apiKeyRejected); expect(env.kc.entries.size).toBe(0);
  });
  it('--json prints the principal; device login afterwards replaces the key', async () => {
    env = await accountEnv({ stdin: KEY, override: apiKeyServer('pro') });
    expect(await env.run('login', '--api-key-stdin', '--json')).toBe(0); expect(JSON.parse(env.out[0]!)).toMatchObject({ principal: 'api_key', plan: 'pro', persisted: true });
    expect(await env.run('login', '--no-browser')).toBe(0); expect(env.kc.entries.has(`apikey:${env.host}`)).toBe(false); expect(env.kc.entries.has(`refresh:${env.host}`)).toBe(true);
  });
});
