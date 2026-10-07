import { afterEach, describe, expect, it, vi } from 'vitest';
import { MSG } from '../../src/commands/account/messages.js';
import { accountEnv, json, type Env, type Req } from './helpers.js';

let env: Env | undefined; afterEach(async () => { await env?.stop(); env = undefined; });
const OTHER = 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4X';
const dev = (id: string, name: string, platform: string, last: string | null, fp: string) => ({ id, name, platform, created_at: '2026-09-01T10:00:00.000Z', last_seen_at: last, key_fingerprint: fp });
/** GET /v1/devices answers `rows()`; everything else goes to the mock. */
const devicesServer = (rows: () => unknown[]) => (r: Req) => (r.method === 'GET' && r.path === '/v1/devices' ? json(200, { data: rows(), next_cursor: null, has_more: false }) : undefined);
const deletes = (e: Env) => e.seen.filter((r) => r.method === 'DELETE');

describe('devices list (acceptance 5)', () => {
  it('marks the current device (the dev claim) and prints fingerprint, platform and last seen', async () => {
    let current = ''; env = await accountEnv({ override: devicesServer(() => [dev(current, 'Work laptop', 'linux', '2026-10-06T11:30:00.000Z', 'ABCD-EFGH-IJKL'), dev(OTHER, 'Phone\u001b[31m', 'macos', null, 'MNOP-QRST-UVWX')]) });
    current = (await env.signIn()).deviceId;
    expect(await env.run('devices', 'list')).toBe(0);
    expect(env.out[0]).toBe(MSG.devices.header);
    expect(env.out[1]).toMatch(new RegExp(`^\\* Work laptop\\s+linux\\s+2026-10-06 11:30\\s+ABCD-EFGH-IJKL\\s+${current}$`));
    expect(env.out[2]).toMatch(new RegExp(`^  Phone\\[31m\\s+macos\\s+never\\s+MNOP-QRST-UVWX\\s+${OTHER}$`)); expect(env.out.join('')).not.toContain('\u001b');
    expect(env.out.at(-1)).toBe(MSG.devices.legend);
  });
  it('--json gives {devices:[{id,name,platform,last_seen,fingerprint,current}]}', async () => {
    let current = ''; env = await accountEnv({ override: devicesServer(() => [dev(current, 'A', 'linux', null, 'ABCD-EFGH-IJKL'), dev(OTHER, 'B', 'windows', '2026-10-01T00:00:00.000Z', 'MNOP-QRST-UVWX')]) });
    current = (await env.signIn()).deviceId;
    expect(await env.run('devices', 'list', '--json')).toBe(0);
    expect(JSON.parse(env.out[0]!)).toEqual({ devices: [{ id: current, name: 'A', platform: 'linux', last_seen: null, fingerprint: 'ABCD-EFGH-IJKL', current: true }, { id: OTHER, name: 'B', platform: 'windows', last_seen: '2026-10-01T00:00:00.000Z', fingerprint: 'MNOP-QRST-UVWX', current: false }] });
  });
  it('an empty list prints a friendly line and exits 0', async () => {
    env = await accountEnv({ override: devicesServer(() => []) }); await env.signIn();
    expect(await env.run('devices', 'list')).toBe(0); expect(env.out).toEqual([MSG.devices.empty]);
  });
  it('follows every page of the mock (47 generated devices)', async () => {
    env = await accountEnv(); await env.signIn();
    expect(await env.run('devices', 'list', '--json')).toBe(0); expect(JSON.parse(env.out[0]!).devices).toHaveLength(47);
    expect(env.seen.filter((r) => r.path === '/v1/devices')).toHaveLength(1);
  });
  it('not signed in: exit 2, no request; bad usage: exit 1', async () => {
    env = await accountEnv();
    expect(await env.run('devices', 'list')).toBe(2); expect(env.seen).toHaveLength(0);
    expect(await env.run('devices')).toBe(1); expect(await env.run('devices', 'list', '--bogus')).toBe(1); expect(env.err).toContain(MSG.usage.devices);
  });
});

describe('devices revoke (acceptance 6)', () => {
  it('revoking another device with --yes sends DELETE /v1/devices/{id} and keeps us signed in', async () => {
    env = await accountEnv(); await env.signIn();
    expect(await env.run('devices', 'revoke', OTHER, '--yes')).toBe(0); expect(deletes(env).map((r) => r.path)).toEqual([`/v1/devices/${OTHER}`]);
    expect(env.out).toEqual([MSG.devices.revoked(OTHER)]); expect((await env.tm.status()).signedIn).toBe(true);
  });
  it('revoking the current device warns, clears local tokens and exits 0 with a logged-out message', async () => {
    env = await accountEnv(); const { deviceId } = await env.signIn();
    expect(await env.run('devices', 'revoke', deviceId, '--yes')).toBe(0);
    expect(env.err).toContain(MSG.devices.confirmCurrent); expect(env.out).toEqual([MSG.devices.revokedCurrent]); expect(env.kc.entries.size).toBe(0);
    expect(await env.run('whoami')).toBe(2);
  });
  describe('confirmation matrix', () => {
    it('TTY without --yes asks; yes revokes', async () => {
      const confirm = vi.fn(async (_q: string) => true); env = await accountEnv({ isTTY: true, confirm }); await env.signIn();
      expect(await env.run('devices', 'revoke', OTHER)).toBe(0); expect(confirm).toHaveBeenCalledTimes(1); expect(confirm.mock.calls[0]![0]).toContain(OTHER); expect(deletes(env)).toHaveLength(1);
    });
    it('TTY without --yes asks; no keeps it and exits 1', async () => {
      const confirm = vi.fn(async () => false); env = await accountEnv({ isTTY: true, confirm }); await env.signIn();
      expect(await env.run('devices', 'revoke', OTHER)).toBe(1); expect(confirm).toHaveBeenCalledTimes(1); expect(deletes(env)).toHaveLength(0); expect(env.err).toContain(MSG.devices.notRevoked);
    });
    it('TTY with --yes does not ask', async () => {
      const confirm = vi.fn(async () => false); env = await accountEnv({ isTTY: true, confirm }); await env.signIn();
      expect(await env.run('devices', 'revoke', OTHER, '--yes')).toBe(0); expect(confirm).not.toHaveBeenCalled(); expect(deletes(env)).toHaveLength(1);
    });
    it('non-TTY without --yes exits 1 without calling DELETE and without prompting', async () => {
      const confirm = vi.fn(async (_q: string) => true); env = await accountEnv({ isTTY: false, confirm }); await env.signIn();
      expect(await env.run('devices', 'revoke', OTHER)).toBe(1); expect(confirm).not.toHaveBeenCalled(); expect(deletes(env)).toHaveLength(0); expect(env.err).toEqual([MSG.devices.needsYes]);
    });
    it('the current device on a TTY: the warning comes before the question', async () => {
      const confirm = vi.fn(async (_q: string) => true); env = await accountEnv({ isTTY: true, confirm }); const { deviceId } = await env.signIn();
      expect(await env.run('devices', 'revoke', deviceId)).toBe(0); expect(env.err[0]).toBe(MSG.devices.confirmCurrent); expect(env.kc.entries.size).toBe(0);
    });
  });
  it('a malformed id is refused before any request; a server 404 is exit 1', async () => {
    env = await accountEnv({ override: (r) => (r.method === 'DELETE' ? json(404, { type: 'x', title: 'x', status: 404, code: 'device_unknown' }) : undefined) }); await env.signIn();
    expect(await env.run('devices', 'revoke', 'laptop', '--yes')).toBe(1); expect(env.err).toEqual([MSG.usage.badDeviceId]); expect(env.seen).toHaveLength(0);
    expect(await env.run('devices', 'revoke', OTHER, '--yes')).toBe(1); expect(env.err.at(-1)).toMatch(/does not know this device/);
  });
});
