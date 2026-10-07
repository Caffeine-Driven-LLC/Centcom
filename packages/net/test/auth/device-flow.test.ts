import { afterEach, describe, expect, it } from 'vitest';
import type { MockBackend } from '@centcom/testkit';
import { CentcomError, DEFAULT_CLI_SCOPES, DEVICE_CODE_GRANT, DeviceFlowDeniedError, DeviceFlowExpiredError, TransportError, createHttpClient, startDeviceLogin } from '../../src/index.js';
import { AutoClock, NO_TIMEOUT, UA, json, problem } from '../http/helpers.js';
import { authMock, fixedKeys, recordingFetch, tokenBody, fakeJwt, DEV, type Rec } from './helpers.js';

let m: MockBackend | undefined; afterEach(async () => { await m?.stop(); m = undefined; });
const tokenCalls = (seen: Rec[]) => seen.filter((r) => r.path === '/v1/auth/token');

/** A scripted server on the auto clock: device/code answers `dc`, then each token poll gets the next answer (the last repeats). */
function scriptedFlow(dc: Record<string, unknown>, polls: (() => Response)[]) {
  const clock = new AutoClock(); let n = 0;
  const r = recordingFetch(undefined, { time: () => clock.now(), override: (rec) => (rec.path === '/v1/auth/device/code' ? json(200, dc) : polls[Math.min(n++, polls.length - 1)]!()) });
  const http = createHttpClient({ getAccessToken: async () => undefined, baseUrl: 'https://api.centcom.dev', userAgent: UA, fetch: r.fetch, clock: new AutoClock(), timeoutMs: NO_TIMEOUT });
  return { http, clock, seen: r.seen, ctl: r.ctl };
}
const DC = { device_code: 'dc_scripted_device_code_value_0001', user_code: 'BCDF-GHJK', verification_uri: 'https://centcom.dev/device', verification_uri_complete: 'https://centcom.dev/device?user_code=BCDF-GHJK', expires_in: 600, interval: 5 };
const pending = () => problem(400, 'authorization_pending');

describe('device login against the mock (acceptance 1, 2, 4)', () => {
  it('pending x3 then success: token requests at t=5, 10, 15, 20 s with the device-code grant, resolving with a TokenSet', async () => {
    const t = await authMock(); m = t.m; const t0 = m.clock.now();
    const login = await startDeviceLogin({ http: t.http, deviceName: 'laptop', keys: fixedKeys, clock: t.clock });
    await m.control('errors', { code: 'authorization_pending', count: 1 }); /* the mock approves itself on its 3rd poll; one injected pending makes it 3 pending then success */
    const tokens = await login.poll();
    const polls = tokenCalls(t.seen);
    expect(polls.map((r) => (r.t - t0) / 1000)).toEqual([5, 10, 15, 20]);
    expect(polls.map((r) => r.status)).toEqual([400, 400, 400, 200]);
    expect(polls.every((r) => r.body?.grant_type === DEVICE_CODE_GRANT && r.body?.client_id === 'centcom-cli' && typeof r.body?.device_code === 'string')).toBe(true);
    expect(tokens.deviceId).toMatch(/^dev_/); expect(tokens.accessToken.split('.')).toHaveLength(3); expect(tokens.refreshToken).toBeTruthy(); expect(tokens.expiresInS).toBe(900);
    expect(t.clock.pending()).toBe(0);
  });
  it('slow_down once: every following interval is 10 s and stays 10 s', async () => {
    const t = await authMock(); m = t.m; const t0 = m.clock.now();
    const login = await startDeviceLogin({ http: t.http, deviceName: 'laptop', keys: fixedKeys, clock: t.clock });
    await m.control('errors', { code: 'slow_down', count: 1 });
    await login.poll();
    const times = tokenCalls(t.seen).map((r) => (r.t - t0) / 1000);
    expect(times).toEqual([5, 15, 25, 35]); expect(times.slice(1).map((x, i) => x - times[i]!)).toEqual([10, 10, 10]);
  });
  it('the device/code body carries 43-char base64url keys, client_id centcom-cli, the default CLI scope and the device name', async () => {
    const t = await authMock(); m = t.m;
    const login = await startDeviceLogin({ http: t.http, deviceName: '  my laptop  ', keys: fixedKeys, clock: t.clock });
    const b = t.seen.find((r) => r.path === '/v1/auth/device/code')!.body!;
    const k = b.device_pubkeys as { x25519: string; ed25519: string };
    expect(k.x25519).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(k.ed25519).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b).toMatchObject({ client_id: 'centcom-cli', scope: DEFAULT_CLI_SCOPES, device_name: 'my laptop' });
    expect(DEFAULT_CLI_SCOPES).toBe('profile workspaces:read sessions:read sessions:write sessions:host usage:write billing:read');
    expect(login.userCode).toMatch(/^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/); expect(login.verificationUriComplete).toBe(`https://centcom.dev/device?user_code=${login.userCode}`);
    expect(login).toMatchObject({ intervalS: 5, verificationUri: 'https://centcom.dev/device' });
  });
  it('centcom-tui and a custom scope are passed through', async () => {
    const t = await authMock(); m = t.m;
    await startDeviceLogin({ http: t.http, deviceName: 'tui', keys: fixedKeys, clock: t.clock, clientId: 'centcom-tui', scopes: 'profile' });
    expect(t.seen[0]!.body).toMatchObject({ client_id: 'centcom-tui', scope: 'profile' });
  });
});

describe('ending the flow (acceptance 3)', () => {
  it('access_denied rejects with DeviceFlowDeniedError after exactly one token request', async () => {
    const t = await authMock(); m = t.m;
    const login = await startDeviceLogin({ http: t.http, deviceName: 'x', keys: fixedKeys, clock: t.clock });
    await m.control('deny-device', { user_code: login.userCode });
    await expect(login.poll()).rejects.toBeInstanceOf(DeviceFlowDeniedError);
    expect(tokenCalls(t.seen)).toHaveLength(1); expect(t.clock.pending()).toBe(0);
  });
  it('expired_token from the server rejects with DeviceFlowExpiredError', async () => {
    const t = await authMock(); m = t.m;
    const login = await startDeviceLogin({ http: t.http, deviceName: 'x', keys: fixedKeys, clock: t.clock });
    await m.control('expire-device', {});
    const e = await login.poll().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DeviceFlowExpiredError); expect(tokenCalls(t.seen)).toHaveLength(1);
  });
  it('reaching expires_in (600 s) rejects with DeviceFlowExpiredError and no request is made at or after the deadline', async () => {
    const s = scriptedFlow(DC, [pending]); const t0 = s.clock.now();
    const login = await startDeviceLogin({ http: s.http, deviceName: 'x', keys: fixedKeys, clock: s.clock });
    await expect(login.poll()).rejects.toBeInstanceOf(DeviceFlowExpiredError);
    const polls = tokenCalls(s.seen); expect(polls).toHaveLength(119);
    expect((polls.at(-1)!.t - t0) / 1000).toBe(595); expect(s.clock.now() - t0).toBe(600_000); expect(s.clock.pending()).toBe(0);
  });
  it('a slow_down near the deadline still stops exactly at the deadline', async () => {
    const s = scriptedFlow({ ...DC, expires_in: 12 }, [() => problem(400, 'slow_down'), pending]); const t0 = s.clock.now();
    const login = await startDeviceLogin({ http: s.http, deviceName: 'x', keys: fixedKeys, clock: s.clock });
    await expect(login.poll()).rejects.toBeInstanceOf(DeviceFlowExpiredError);
    expect(tokenCalls(s.seen).map((r) => (r.t - t0) / 1000)).toEqual([5]); expect(s.clock.now() - t0).toBe(12_000);
  });
  it('abort during the wait rejects at once with an aborted error, sends nothing more and leaves no timer', async () => {
    const t = await authMock(); m = t.m; const ac = new AbortController();
    const login = await startDeviceLogin({ http: t.http, deviceName: 'x', keys: fixedKeys, clock: t.clock });
    const p = login.poll(ac.signal); await new Promise((r) => setImmediate(r)); ac.abort();
    const e = await p.catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CentcomError); expect((e as CentcomError).kind).toBe('aborted');
    expect(tokenCalls(t.seen)).toHaveLength(0); expect(t.clock.pending()).toBe(0);
    await m.advance(60_000); expect(tokenCalls(t.seen)).toHaveLength(0);
  });
  it('an already aborted signal rejects before any request; poll() cannot run twice', async () => {
    const s = scriptedFlow(DC, [pending]); const login = await startDeviceLogin({ http: s.http, deviceName: 'x', keys: fixedKeys, clock: s.clock });
    const ac = new AbortController(); ac.abort();
    await expect(login.poll(ac.signal)).rejects.toMatchObject({ kind: 'aborted' }); await expect(login.poll()).rejects.toBeInstanceOf(TypeError);
    expect(tokenCalls(s.seen)).toHaveLength(0);
  });
});

describe('failure paths', () => {
  it('network failures are retried at the interval; three in a row end the flow with the TransportError', async () => {
    const s = scriptedFlow(DC, [pending]); const login = await startDeviceLogin({ http: s.http, deviceName: 'x', keys: fixedKeys, clock: s.clock });
    s.ctl.offline = true;
    const e = await login.poll().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TransportError); expect(tokenCalls(s.seen)).toHaveLength(3);
  });
  it('a network blip in between polls does not end the flow', async () => {
    const down = () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
    const s = scriptedFlow(DC, [pending, down, down, pending, () => json(200, tokenBody(fakeJwt({ exp: 2_000_000_000, dev: DEV }), 'rt_x'))]);
    const login = await startDeviceLogin({ http: s.http, deviceName: 'x', keys: fixedKeys, clock: s.clock });
    await expect(login.poll()).resolves.toMatchObject({ deviceId: DEV }); expect(tokenCalls(s.seen)).toHaveLength(5);
  });
  it('rate_limited waits the longer of Retry-After and the interval, never less than the interval', async () => {
    const s = scriptedFlow(DC, [() => problem(429, 'rate_limited', { retry_after_s: 20 }), () => problem(429, 'rate_limited', { retry_after_s: 1 }), () => json(200, tokenBody(fakeJwt({ exp: 2_000_000_000 }), 'rt_y'))]); const t0 = s.clock.now();
    const login = await startDeviceLogin({ http: s.http, deviceName: 'x', keys: fixedKeys, clock: s.clock });
    await login.poll();
    expect(tokenCalls(s.seen).map((r) => (r.t - t0) / 1000)).toEqual([5, 25, 30]);
  });
  it('an unexpected server error ends the flow with that error', async () => {
    const s = scriptedFlow(DC, [() => problem(400, 'invalid_grant')]); const login = await startDeviceLogin({ http: s.http, deviceName: 'x', keys: fixedKeys, clock: s.clock });
    await expect(login.poll()).rejects.toMatchObject({ code: 'invalid_grant' });
  });
  it('bad device keys or a malformed user code are refused', async () => {
    const s = scriptedFlow(DC, [pending]);
    await expect(startDeviceLogin({ http: s.http, deviceName: 'x', keys: { getOrCreatePublicKeys: async () => ({ x25519: 'short', ed25519: 'short' }) }, clock: s.clock })).rejects.toBeInstanceOf(TypeError);
    expect(s.seen).toHaveLength(0);
    const bad = scriptedFlow({ ...DC, user_code: 'abcd-efgh' }, [pending]);
    await expect(startDeviceLogin({ http: bad.http, deviceName: 'x', keys: fixedKeys, clock: bad.clock })).rejects.toBeInstanceOf(TypeError);
  });
  it('a token answer without any device id is a protocol error', async () => {
    const s = scriptedFlow(DC, [() => json(200, { access_token: fakeJwt({ exp: 2_000_000_000 }), token_type: 'Bearer', expires_in: 900, refresh_token: 'rt_z', scope: 'profile' })]);
    const login = await startDeviceLogin({ http: s.http, deviceName: 'x', keys: fixedKeys, clock: s.clock });
    await expect(login.poll()).rejects.toMatchObject({ kind: 'protocol' });
  });
});
