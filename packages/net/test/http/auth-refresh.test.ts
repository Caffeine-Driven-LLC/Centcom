import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MockBackend } from '@centcom/testkit';
import { ApiError, AuthExpiredError, nextAction } from '../../src/index.js';
import { ME, json, onMock, problem, scripted } from './helpers.js';

let m: MockBackend | undefined; afterEach(async () => { await m?.stop(); m = undefined; });
const devOf = (jwt: string) => (JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as { dev: string }).dev;

describe('401 token_expired against the mock', () => {
  it('calls onUnauthorized exactly once, replays once with the new token, and succeeds', async () => {
    let t!: Awaited<ReturnType<typeof onMock>>;
    const hook = vi.fn(async () => { t.setToken(t.m.mintToken()); return true; });
    t = await onMock({ onUnauthorized: hook }); m = t.m; t.setToken(m.mintToken({ expSeconds: 5 })); const old = t.token(); await m.advance(10_000);
    const r = await t.client.call('getMe', {});
    expect(r.status).toBe(200); expect(hook).toHaveBeenCalledTimes(1); expect(hook).toHaveBeenCalledWith('token_expired'); expect(t.seen).toHaveLength(2);
    expect(t.seen[0]!.headers.authorization).toBe(`Bearer ${old}`); expect(t.seen[1]!.headers.authorization).toBe(`Bearer ${t.token()}`); expect(t.seen[1]!.headers['x-request-id']).toBe(t.seen[0]!.headers['x-request-id']);
  });
  it('token_revoked, token_invalid and device_revoked never call the hook and throw', async () => {
    const hook = vi.fn(async () => true); const t = await onMock({ onUnauthorized: hook }); m = t.m;
    t.setToken('not.a.jwt'); const invalid = await t.client.call('getMe', {}).catch((x: unknown) => x);
    expect(invalid).toBeInstanceOf(ApiError); expect(invalid).toMatchObject({ code: 'token_invalid', status: 401, attempts: 1 }); expect(invalid).not.toBeInstanceOf(AuthExpiredError);
    const tok = m.mintToken(); t.setToken(tok); await m.control('revoke-device', { device: devOf(tok) });
    expect(await t.client.call('getMe', {}).catch((x: unknown) => x)).toMatchObject({ code: 'device_revoked', status: 401 });
    const tok2 = m.mintToken(); t.setToken(tok2); await t.client.call('revokeToken', { body: { token: tok2 } });
    const revoked = await t.client.call('getMe', {}).catch((x: unknown) => x) as ApiError; expect(revoked.code).toBe('token_revoked'); expect(nextAction(revoked)).toBe('reauthenticate');
    expect(hook).not.toHaveBeenCalled();
  });
});

describe('the refresh hook contract', () => {
  it('a burst of 10 concurrent 401 token_expired calls makes one refresh, and all 10 succeed', async () => {
    let token = 'tok-A'; let gate!: () => void; const ready = new Promise<void>((r) => { gate = r; });
    const hook = vi.fn(async () => { await ready; token = 'tok-B'; return true; });
    const { client, seen } = scripted([(r) => (r.headers.authorization === 'Bearer tok-B' ? json(200, ME) : problem(401, 'token_expired'))], { getAccessToken: async () => token, onUnauthorized: hook });
    const all = Promise.all(Array.from({ length: 10 }, () => client.call('getMe', {})));
    await new Promise((r) => setTimeout(r, 20)); gate();
    const results = await all;
    expect(results.every((r) => r.status === 200)).toBe(true); expect(hook).toHaveBeenCalledTimes(1);
    expect(seen.filter((s) => s.headers.authorization === 'Bearer tok-A')).toHaveLength(10); expect(seen.filter((s) => s.headers.authorization === 'Bearer tok-B')).toHaveLength(10);
  });
  it('a 401 that arrives after another call already refreshed replays without calling the hook again', async () => {
    let token = 'tok-A'; const hook = vi.fn(async () => { token = 'tok-B'; return true; }); let release!: () => void; const late = new Promise<void>((r) => { release = r; }); let n = 0;
    const { client } = scripted([async (r) => { if (r.headers.authorization === 'Bearer tok-B') return json(200, ME); n++; if (n === 2) await late; return problem(401, 'token_expired'); }], { getAccessToken: async () => token, onUnauthorized: hook });
    const p1 = client.call('getMe', {}); const p2 = client.call('getMe', {});
    await p1; release(); expect((await p2).status).toBe(200); expect(hook).toHaveBeenCalledTimes(1);
  });
  it('a hook that fails or says no throws AuthExpiredError with the original 401; no loop, no second refresh', async () => {
    for (const hook of [vi.fn(async () => { throw new Error('offline'); }), vi.fn(async () => false)]) {
      const { client, seen } = scripted([problem(401, 'token_expired')], { onUnauthorized: hook });
      const e = await client.call('getMe', {}).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(AuthExpiredError); expect(e).toMatchObject({ code: 'token_expired', status: 401 }); expect(hook).toHaveBeenCalledTimes(1); expect(seen).toHaveLength(1);
    }
  });
  it('a refreshed token that is still refused ends with AuthExpiredError after exactly one replay', async () => {
    let token = 'tok-A'; const hook = vi.fn(async () => { token = 'tok-B'; return true; });
    const { client, seen } = scripted([problem(401, 'token_expired')], { getAccessToken: async () => token, onUnauthorized: hook });
    const e = await client.call('getMe', {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AuthExpiredError); expect(hook).toHaveBeenCalledTimes(1); expect(seen).toHaveLength(2);
  });
  it('without a hook a 401 token_expired is thrown as AuthExpiredError at once', async () => {
    const { client, seen } = scripted([problem(401, 'token_expired')]); await expect(client.call('getMe', {})).rejects.toBeInstanceOf(AuthExpiredError); expect(seen).toHaveLength(1);
  });
  it('withAuthProvider gives a client with another identity and its own refresh hook', async () => {
    const hookA = vi.fn(async () => false); const hookB = vi.fn(async () => { tokB = 'B2'; return true; }); let tokB = 'B1';
    const { client, seen } = scripted([(r) => (r.headers.authorization === 'Bearer B2' ? json(200, ME) : problem(401, 'token_expired'))], { onUnauthorized: hookA });
    const b = client.withAuthProvider({ getAccessToken: async () => tokB, onUnauthorized: hookB });
    expect((await b.call('getMe', {})).status).toBe(200); expect(hookB).toHaveBeenCalledTimes(1); expect(hookA).not.toHaveBeenCalled(); expect(seen.map((s) => s.headers.authorization)).toEqual(['Bearer B1', 'Bearer B2']);
  });
  it('public operations never carry a token; optional-auth ones carry it when there is one', async () => {
    const { client, seen } = scripted([json(200, { status: 'operational', updated_at: '2026-10-06T12:00:00.000Z', components: [], incidents: [], min_client_version: '1.0.0', contract_version: '1.2.0' })]);
    await client.getStatus(); expect(seen[0]!.headers.authorization).toBeUndefined();
    const f = scripted([json(200, { flags: {}, rev: 1, ttl_s: 60 })]); await f.client.call('getFlags', {}); expect(f.seen[0]!.headers.authorization).toBe('Bearer tok-A');
    const anon = scripted([json(200, { flags: {}, rev: 1, ttl_s: 60 })], { getAccessToken: async () => undefined }); await anon.client.call('getFlags', {}); expect(anon.seen[0]!.headers.authorization).toBeUndefined();
  });
});
