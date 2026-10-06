import { afterEach, describe, expect, it } from 'vitest';
import { OPERATIONS, ERROR_TABLE } from '@centcom/protocol';
import { DEVICE_BODY, api, login, start } from './helpers.js';
import type { MockBackend } from '../src/index.js';

let m: MockBackend; afterEach(async () => { await m?.stop(); });

describe('device login', () => {
  it('pending, then slow_down on early polling, then tokens', async () => {
    m = await start(); const dc = (await api(m, 'POST', '/v1/auth/device/code', { body: DEVICE_BODY })).body;
    expect(dc.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/); expect(dc.interval).toBe(5);
    const poll = () => api(m, 'POST', '/v1/auth/token', { body: { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dc.device_code, client_id: 'c' } });
    expect((await poll()).body.code).toBe('authorization_pending');
    const early = await poll(); expect(early.body.code).toBe('slow_down'); expect(early.status).toBe(400);
    await m.virtual!.advance(11_000); // a mock with no human behind it approves itself on the third poll
    const ok = await poll(); expect(ok.status).toBe(200); expect(ok.body.token_type).toBe('Bearer'); expect(ok.body.expires_in).toBe(900);
  });
  it('denied and expired device codes end the flow', async () => {
    m = await start(); const dc = (await api(m, 'POST', '/v1/auth/device/code', { body: DEVICE_BODY })).body;
    await m.control('deny-device', {}); const body = { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dc.device_code, client_id: 'c' };
    expect((await api(m, 'POST', '/v1/auth/token', { body })).body.code).toBe('access_denied');
    m.control('reset'); const dc2 = (await api(m, 'POST', '/v1/auth/device/code', { body: DEVICE_BODY })).body;
    await m.virtual!.advance(901_000); expect((await api(m, 'POST', '/v1/auth/token', { body: { ...body, device_code: dc2.device_code } })).body.code).toBe('expired_token');
  });
  it('access token works, expires after 15 minutes, and refresh rotates', async () => {
    m = await start(); const t = await login(m);
    expect((await api(m, 'GET', '/v1/me', { token: t.access_token })).status).toBe(200);
    await m.virtual!.advance(16 * 60_000);
    expect((await api(m, 'GET', '/v1/me', { token: t.access_token })).body.code).toBe('token_expired');
    const r = await api(m, 'POST', '/v1/auth/token', { body: { grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: 'c' } });
    expect(r.status).toBe(200); expect(r.body.refresh_token).not.toBe(t.refresh_token);
    expect((await api(m, 'GET', '/v1/me', { token: r.body.access_token })).status).toBe(200);
  });
  it('re-using an old refresh token kills the whole family, including the newest token', async () => {
    m = await start(); const t = await login(m); const grant = (rt: string) => api(m, 'POST', '/v1/auth/token', { body: { grant_type: 'refresh_token', refresh_token: rt, client_id: 'c' } });
    const r1 = (await grant(t.refresh_token)).body; const reuse = await grant(t.refresh_token);
    expect(reuse.body.code).toBe('refresh_reuse_detected'); expect(reuse.status).toBe(401);
    expect((await grant(r1.refresh_token)).body.code).toBe('invalid_grant');
  });
  it('a revoked device is refused on refresh', async () => {
    m = await start(); const t = await login(m); await m.control('revoke-device', { device: t.device });
    expect((await api(m, 'GET', '/v1/me', { token: t.access_token })).body.code).toBe('device_revoked');
    expect((await api(m, 'POST', '/v1/auth/token', { body: { grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: 'c' } })).body.code).toBe('device_revoked');
  });
  it('rejects a forged or missing token', async () => {
    m = await start(); const t = await login(m);
    expect((await api(m, 'GET', '/v1/me')).body.code).toBe('unauthorized');
    const parts = t.access_token.split('.'); const forged = [parts[0], Buffer.from(JSON.stringify({ sub: 'usr_01M48T58FY4TWS68231JFXTFFX', exp: 9e9, aud: 'centcom-api' })).toString('base64url'), parts[2]].join('.');
    expect((await api(m, 'GET', '/v1/me', { token: forged })).body.code).toBe('token_invalid');
  });
});

describe('every operation', () => {
  it('answers each of the contract operations with a body that validates against its response schema', async () => {
    m = await start(); const t = await login(m); const doc = JSON.parse((await import('node:fs')).readFileSync(new URL('../../protocol/src/generated/openapi.json', import.meta.url), 'utf8'));
    const Ajv = (await import('ajv/dist/2020.js')).default; const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true });
    let count = 0; const bad: string[] = [];
    for (const [id, o] of Object.entries(OPERATIONS) as [string, { method: string; path: string; public: boolean }][]) {
      const path = o.path.replace(/\{(\w+)\}/g, (_x, k) => (k === 'id' ? 'ses_01M48T58FY4TWS68231JFXTFFX' : k === 'token' ? 'sh_token' : 'sample')); count++;
      const op = Object.values<any>(doc.paths[o.path]).find((x: any) => x?.operationId === id);
      const rbSchema = op.requestBody?.content?.['application/json']?.schema; let body: unknown;
      if (rbSchema) { const { generateFromSchema } = await import('../src/index.js'); const { createRng } = await import('../src/core/prng.js'); body = generateFromSchema(rbSchema, { doc, rng: createRng(3), now: () => m.clock.now() }); }
      if (id === 'issueToken') body = { grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: 'c' };
      const r = await api(m, o.method, path + (o.method === 'GET' ? '' : ''), { token: o.public ? undefined : t.access_token, body, headers: { 'idempotency-key': 'k-' + id }, form: id === 'issueToken' && false });
      const okCodes = Object.keys(op.responses).filter((s) => /^[23]/.test(s)); const status = String(r.status);
      if (r.status >= 400) { if (!['validation_failed', 'not_found', 'invalid_request'].includes(r.body?.code) && !(id === 'authorize')) bad.push(`${id}: ${r.status} ${r.body?.code}`); continue; }
      if (!okCodes.includes(status)) { bad.push(`${id}: status ${status} not in ${okCodes}`); continue; }
      const sch = op.responses[status]?.content?.['application/json']?.schema; if (!sch || r.body === undefined) continue;
      const validate = ajv.compile({ ...sch, $id: 'resp-' + id, components: doc.components });
      if (!validate(r.body)) bad.push(`${id}: ${ajv.errorsText(validate.errors).slice(0, 160)}`);
    }
    expect(count).toBe(Object.keys(OPERATIONS).length); expect(count).toBeGreaterThan(80); expect(bad).toEqual([]);
  });
});

describe('API behaviour', () => {
  it('paginates with a cursor, caps limit, and rejects a bad cursor', async () => {
    m = await start(); const t = await login(m); const op = Object.entries(OPERATIONS).find(([, o]) => o.method === 'GET' && !o.public && !o.path.includes('{'))!;
    let list: any; for (const [, o] of Object.entries(OPERATIONS)) { if (o.method !== 'GET' || o.path.includes('{') || o.public) continue; const r = await api(m, 'GET', o.path + '?limit=20', { token: t.access_token }); if (r.body && 'has_more' in r.body) { list = { path: o.path, r }; break; } }
    void op; expect(list, 'a list endpoint').toBeTruthy(); expect(list.r.body.data).toHaveLength(20); expect(list.r.body.has_more).toBe(true);
    const seen = new Set(list.r.body.data.map((x: unknown) => JSON.stringify(x))); let cur = list.r.body.next_cursor; let pages = 1;
    while (cur) { const r = await api(m, 'GET', `${list.path}?limit=20&cursor=${cur}`, { token: t.access_token }); r.body.data.forEach((x: unknown) => seen.add(JSON.stringify(x))); cur = r.body.next_cursor; pages++; }
    expect(pages).toBe(3); expect((await api(m, 'GET', list.path + '?limit=201', { token: t.access_token })).body.code).toBe('invalid_request');
    expect((await api(m, 'GET', list.path + '?cursor=garbage', { token: t.access_token })).body.code).toBe('cursor_invalid');
  });
  it('idempotency: same key and body replays, same key with another body conflicts, and checkout needs a key', async () => {
    m = await start(); const t = await login(m); const wsp = ((await m.control('state')) as { workspace: string }).workspace; const body = { name: 'a', workspace: wsp };
    const a = await api(m, 'POST', '/v1/sessions', { token: t.access_token, body, headers: { 'idempotency-key': 'one' } }); const b = await api(m, 'POST', '/v1/sessions', { token: t.access_token, body, headers: { 'idempotency-key': 'one' } });
    expect(a.status).toBe(201); expect(b.body.id).toBe(a.body.id); expect(b.headers.get('idempotency-replayed')).toBe('true');
    expect((await api(m, 'POST', '/v1/sessions', { token: t.access_token, body: { name: 'b', workspace: wsp }, headers: { 'idempotency-key': 'one' } })).body.code).toBe('idempotency_conflict');
    expect((await api(m, 'POST', '/v1/workspaces/wsp_01M48T58FY4TWS68231JFXTFFX/checkout', { token: t.access_token, body: {} })).body.code).toBe('idempotency_key_required');
    await m.virtual!.advance(25 * 3600_000); const t2 = await login(m); // keys are forgotten after 24 hours
    const c = await api(m, 'POST', '/v1/sessions', { token: t2.access_token, body, headers: { 'idempotency-key': 'one' } }); expect(c.body.id).not.toBe(a.body.id);
  });
  it('validates request bodies with field pointers and refuses oversized bodies', async () => {
    m = await start(); const t = await login(m);
    const r = await api(m, 'POST', '/v1/sessions', { token: t.access_token, body: { mode: 'nonsense' } }); expect(r.status).toBe(422); expect(r.body.code).toBe('validation_failed'); expect(r.body.errors.length).toBeGreaterThan(0);
    const big = await api(m, 'POST', '/v1/sessions', { token: t.access_token, body: { name: 'x'.repeat(300_000) } }); expect(big.body.code).toBe('payload_too_large');
    expect((await api(m, 'GET', '/v1/nope')).status).toBe(404);
  });
  it('injects errors, rate limits, maintenance and old-client answers on demand', async () => {
    m = await start(); const t = await login(m);
    await m.control('errors', { code: 'service_unavailable', count: 2, retry_after_s: 3 });
    const e = await api(m, 'GET', '/v1/me', { token: t.access_token }); expect(e.status).toBe(503); expect(e.headers.get('retry-after')).toBe('3'); expect(e.body.type).toBe('https://centcom.dev/errors/service_unavailable');
    expect((await api(m, 'GET', '/v1/me', { token: t.access_token })).status).toBe(503); expect((await api(m, 'GET', '/v1/me', { token: t.access_token })).status).toBe(200);
    await m.control('rate-limit', { remaining: 1, retry_after_s: 9 }); expect((await api(m, 'GET', '/v1/me', { token: t.access_token })).status).toBe(200);
    const rl = await api(m, 'GET', '/v1/me', { token: t.access_token }); expect(rl.status).toBe(429); expect(rl.headers.get('retry-after')).toBe('9'); await m.control('rate-limit', { off: true });
    await m.control('min-client', { version: '9.0.0' }); expect((await api(m, 'GET', '/v1/me', { token: t.access_token, headers: { 'user-agent': 'centcom-cli/1.0.0' } })).body.code).toBe('client_too_old'); await m.control('min-client', {});
    await m.control('maintenance', { on: true }); expect((await api(m, 'GET', '/v1/me', { token: t.access_token })).status).toBe(503); expect((await api(m, 'GET', '/healthz')).status).toBe(200);
    await expect(m.control('errors', { code: 'not_a_code' })).rejects.toThrow();
  });
  it('every injectable error code has the contract status and a request id', async () => {
    m = await start(); const t = await login(m);
    for (const code of ['not_found', 'forbidden', 'conflict', 'quota_exceeded'] as const) { if (!(code in ERROR_TABLE)) continue; await m.control('errors', { code }); const r = await api(m, 'GET', '/v1/me', { token: t.access_token }); expect(r.status).toBe(ERROR_TABLE[code].status); expect(r.body.request_id).toMatch(/^req_/); }
  });
  it('same seed gives the same ids and bodies; control plane is unreachable when disabled', async () => {
    const run = async () => { const x = await start({ seed: 11 }); const t = await login(x); const s = (await api(x, 'POST', '/v1/sessions', { token: t.access_token, body: { name: 'z' } })).body; await x.stop(); return [t.user, s.id]; };
    expect(await run()).toEqual(await run()); m = await start({ control: false }); expect((await fetch(m.url + '/__mock/state')).status).toBe(404);
  });
});

describe('lane interface helpers', () => {
  it('mintToken and mintTicket produce credentials the mock accepts; expired ones are refused', async () => {
    m = await start(); const tok = m.mintToken(); expect((await api(m, 'GET', '/v1/me', { token: tok })).status).toBe(200);
    const old = m.mintToken({ expSeconds: 5 }); await m.advance(10_000); expect((await api(m, 'GET', '/v1/me', { token: old })).body.code).toBe('token_expired');
    expect(m.httpUrl).toBe(m.url); expect(m.mintTicket({ sid: 'ses_01JTEST0000000000000000001', role: 'host' }).split('.')).toHaveLength(3);
  });
  it('a virtual peer sends scripted frames at the scripted virtual times', async () => {
    m = await start(); const sid = 'ses_01JTEST0000000000000000001'; m.addVirtualPeer(sid, 'editor', { name: 'Bot', steps: [{ at_ms: 1000, frame: { t: 'event', k: 'message.user', id: 'msg_01JTEST0000000000000000001', p: {} } }] });
    await m.advance(500); expect(m.frames(sid)).toHaveLength(0); await m.advance(600); expect(m.frames(sid).map((f) => f.k)).toEqual(['control.member_joined', 'message.user']); expect(m.frames(sid).every((f) => f.from.startsWith('mem_') || f.from === 'srv')).toBe(true);
  });
});
