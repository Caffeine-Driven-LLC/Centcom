import { afterEach, describe, expect, it } from 'vitest';
import { KeychainUnavailableError, memoryKeychain } from '@centcom/net';
import { MSG } from '../../src/commands/account/messages.js';
import { accountEnv, type Env } from './helpers.js';

let env: Env | undefined; afterEach(async () => { await env?.stop(); env = undefined; });

describe('centcom logout', () => {
  it('online: revokes the refresh token once, clears the keychain, exits 0', async () => {
    env = await accountEnv(); await env.signIn();
    expect(await env.run('logout')).toBe(0);
    expect(env.seen.filter((r) => r.path === '/v1/auth/revoke')).toHaveLength(1); expect(env.kc.entries.size).toBe(0);
    expect(env.out).toEqual([MSG.logout.signedOut]); expect(env.err).toEqual([]);
    expect([...env.m.state.families.values()].every((f) => f.revoked)).toBe(true);
  });
  it('offline (acceptance 7): the mock is down, the keychain is cleared, the skipped server revocation is reported, exit 0', async () => {
    env = await accountEnv(); await env.signIn(); await env.m.stop();
    expect(await env.run('logout')).toBe(0); expect(env.kc.entries.size).toBe(0);
    expect(env.out).toEqual([MSG.logout.signedOut]); expect(env.err).toEqual([MSG.logout.revocationSkipped]);
  });
  it('--revoke-device also sends DELETE /v1/devices/{current dev}', async () => {
    env = await accountEnv(); const { deviceId } = await env.signIn();
    expect(await env.run('logout', '--revoke-device')).toBe(0);
    expect(env.seen.filter((r) => r.method === 'DELETE').map((r) => r.path)).toEqual([`/v1/devices/${deviceId}`]);
    expect(env.out).toEqual([MSG.logout.signedOut, MSG.logout.deviceRevoked]); expect(env.kc.entries.size).toBe(0);
  });
  it('--revoke-device offline: local state cleared, both failures reported, exit 0', async () => {
    env = await accountEnv(); await env.signIn(); env.ctl.offline = true;
    expect(await env.run('logout', '--revoke-device')).toBe(0); expect(env.out).toEqual([MSG.logout.signedOut, MSG.logout.deviceRevokeFailed]); expect(env.err).toEqual([MSG.logout.revocationSkipped]);
  });
  it('not signed in: says so, exit 0, no request', async () => {
    env = await accountEnv(); expect(await env.run('logout')).toBe(0); expect(env.out).toEqual([MSG.logout.notSignedIn]); expect(env.seen).toHaveLength(0);
  });
  it('an API key: removed from the keychain, nothing revoked on the server', async () => {
    const key = `cen_live_${'Zz09'.repeat(8)}`; env = await accountEnv(); await env.tm.useApiKey(key);
    expect(await env.run('logout')).toBe(0); expect(env.out).toEqual([MSG.logout.signedOut, MSG.logout.apiKeyRemoved]); expect(env.kc.entries.size).toBe(0); expect(env.seen).toHaveLength(0);
  });
  it('a keychain that cannot be cleared: remediation text, exit 1', async () => {
    const kc = Object.assign(memoryKeychain(), { delete: async () => { throw new KeychainUnavailableError(); } });
    env = await accountEnv({ keychain: kc }); await env.signIn();
    expect(await env.run('logout')).toBe(1); expect(env.err).toContain(MSG.errors.keychain);
  });
  it('bad flags: usage, exit 1', async () => {
    env = await accountEnv(); expect(await env.run('logout', '--all')).toBe(1); expect(env.err).toContain(MSG.usage.logout);
  });
});
