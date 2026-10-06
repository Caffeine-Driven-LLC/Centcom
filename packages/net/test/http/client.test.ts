import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MockBackend } from '@centcom/testkit';
import { ApiError, MAX_RESPONSE_BYTES, RequestTooLargeError, TransportError, createHttpClient, createLogger, createRingSink, defaultUserAgent, parseRateLimit } from '../../src/index.js';
import { FLAGS, ME, REQ_RE, UA, json, onMock, problem, scripted } from './helpers.js';

let m: MockBackend | undefined; afterEach(async () => { await m?.stop(); m = undefined; });
const UA_CT_VER = /^centcom-cli\/\d+\.\d+\.\d+ \(contract\/\d+\.\d+\.\d+; [a-z0-9]+-[a-z0-9_]+; node\/\d+\.\d+\.\d+\)$/;

describe('headers', () => {
  it('every request carries a req_ ULID X-Request-Id and a CT-VER User-Agent; retries reuse the id, new requests get a new one', async () => {
    const { client, seen } = scripted([problem(503, 'service_unavailable'), json(200, FLAGS), json(200, FLAGS)]);
    const r = await client.call('getFlags', {}); await client.call('getFlags', {});
    for (const s of seen) { expect(s.headers['x-request-id']).toMatch(REQ_RE); expect(s.headers['user-agent']).toMatch(UA_CT_VER); expect(s.headers.accept).toContain('application/problem+json'); }
    expect(seen[1]!.headers['x-request-id']).toBe(seen[0]!.headers['x-request-id']); expect(seen[2]!.headers['x-request-id']).not.toBe(seen[0]!.headers['x-request-id']);
    expect(r.requestId).toBe(seen[0]!.headers['x-request-id']); expect(UA).toMatch(UA_CT_VER); expect(defaultUserAgent('2.0.0', 'centcom-tui')).toMatch(/^centcom-tui\/2\.0\.0 \(contract\/1\.2\.0; /);
  });
  it('the token goes only in the Authorization header, never in the URL', async () => {
    const t = await onMock(); m = t.m; await t.client.call('listSessions', { query: { mine: true } });
    for (const s of t.seen) { expect(s.url.toString()).not.toContain(t.token()); expect(s.headers.authorization).toBe(`Bearer ${t.token()}`); }
  });
  it('the mock sees our X-Request-Id and echoes it in errors', async () => {
    const t = await onMock(); m = t.m; await m.control('errors', { code: 'forbidden' });
    const e = await t.client.call('getMe', {}).catch((x: unknown) => x) as ApiError; expect(e.requestId).toBe(t.seen[0]!.headers['x-request-id']);
  });
});

describe('construction', () => {
  it('is inert: createHttpClient makes no call and asks for no token', () => {
    const f = vi.fn(); const tok = vi.fn(async () => 't');
    createHttpClient({ getAccessToken: tok, userAgent: UA, fetch: f as unknown as typeof fetch });
    expect(f).not.toHaveBeenCalled(); expect(tok).not.toHaveBeenCalled();
  });
  it('refuses a malformed User-Agent and a base URL that would leak tokens', () => {
    const mk = (o: object) => () => createHttpClient({ getAccessToken: async () => undefined, userAgent: UA, ...o });
    expect(mk({ userAgent: 'curl/8' })).toThrow(TypeError); expect(mk({ baseUrl: 'http://api.centcom.dev' })).toThrow(TypeError);
    expect(mk({ baseUrl: 'https://u:p@api.centcom.dev' })).toThrow(TypeError); expect(mk({ baseUrl: 'https://api.centcom.dev/?k=1' })).toThrow(TypeError); expect(mk({ baseUrl: 'not a url' })).toThrow(TypeError);
    expect(mk({ baseUrl: 'http://127.0.0.1:9' })).not.toThrow(); expect(mk({ baseUrl: 'https://api.example.test/base/' })).not.toThrow();
  });
  it('defaults to https://api.centcom.dev and keeps a base path', async () => {
    const a = scripted([json(200, FLAGS)], { baseUrl: undefined }); await a.client.call('getFlags', {}); expect(a.seen[0]!.url.toString()).toBe('https://api.centcom.dev/v1/flags');
    const b = scripted([json(200, FLAGS)], { baseUrl: 'https://proxy.example.test/api/' }); await b.client.call('getFlags', {}); expect(b.seen[0]!.url.toString()).toBe('https://proxy.example.test/api/v1/flags');
  });
});

describe('arguments', () => {
  it('path parameters are encoded; missing ones, unknown query keys and wrong bodies are refused before sending', async () => {
    const { client, seen } = scripted([json(204, null)]);
    await client.call('revokeDevice', { path: { id: 'dev_1/../x?y' } }); expect(seen[0]!.url.pathname).toBe('/v1/devices/dev_1%2F..%2Fx%3Fy');
    await expect(client.call('revokeDevice', { path: {} } as never)).rejects.toThrow(TypeError);
    await expect(client.call('getFlags', { body: {} } as never)).rejects.toThrow(TypeError);
    await expect(client.call('updateMe', {} as never)).rejects.toThrow(TypeError);
    await expect(client.call('listSessions', { query: { mine: { a: 1 } } } as never)).rejects.toThrow(TypeError);
    await expect(client.call('nope' as never, {} as never)).rejects.toThrow(TypeError); expect(seen).toHaveLength(1);
  });
  it('a 204 answers with undefined data', async () => {
    const { client } = scripted([new Response(null, { status: 204 })]); const r = await client.call('revokeDevice', { path: { id: 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4W' } }); expect(r.status).toBe(204); expect(r.data).toBeUndefined();
  });
});

describe('request size guard', () => {
  const pad = (target: number, wrap: (s: string) => unknown) => { const base = JSON.stringify(wrap('')).length; return wrap('x'.repeat(target - base)); };
  it('256 KiB + 1 byte is RequestTooLargeError before any network I/O (not even a token request)', async () => {
    const tok = vi.fn(async () => 't'); const { client, seen } = scripted([json(200, ME.user)], { getAccessToken: tok });
    const big = pad(256 * 1024 + 1, (s) => ({ display_name: s }));
    const e = await client.call('updateMe', { body: big as never }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RequestTooLargeError); expect(e).toMatchObject({ size: 256 * 1024 + 1, limit: 256 * 1024, code: 'payload_too_large' }); expect(seen).toHaveLength(0); expect(tok).not.toHaveBeenCalled();
    await client.call('updateMe', { body: pad(256 * 1024, (s) => ({ display_name: s })) as never }); expect(seen).toHaveLength(1);
  });
  it('POST /v1/usage/events takes exactly 1 MiB and refuses 1 MiB + 1 byte', async () => {
    const ev = (s: string) => ({ events: [{ id: 'use_01JA3Z8K2M5N7P9Q0R1S2T3V4W', type: 'agent_minutes', qty: 1, at: '2026-10-06T12:00:00.000Z', pad: s }] });
    const { client, seen } = scripted([json(200, { accepted: 1, duplicates: 0 })]);
    await client.call('ingestUsageEvents', { body: pad(1024 * 1024, ev) as never }); expect(seen).toHaveLength(1); expect(new TextEncoder().encode(seen[0]!.body).byteLength).toBe(1024 * 1024);
    await expect(client.call('ingestUsageEvents', { body: pad(1024 * 1024 + 1, ev) as never })).rejects.toBeInstanceOf(RequestTooLargeError); expect(seen).toHaveLength(1);
  });
  it('multi-byte characters count as bytes, not characters', async () => {
    const { client, seen } = scripted([json(200, ME.user)]);
    await expect(client.call('updateMe', { body: { display_name: 'ü'.repeat(131_072) } as never })).rejects.toBeInstanceOf(RequestTooLargeError); expect(seen).toHaveLength(0);
  });
  it('a response over the cap is refused instead of buffered', async () => {
    const { client } = scripted([new Response('x'.repeat(MAX_RESPONSE_BYTES + 1), { status: 200 })]);
    expect(await client.call('getFlags', {}).catch((x: unknown) => x)).toMatchObject({ transport: 'bad_response' });
  });
});

describe('conditional requests', () => {
  it('a PATCH after a GET sends the stored ETag as If-Match; a stale one gets 412 precondition_failed without a retry', async () => {
    const t = await onMock(); m = t.m;
    const got = await t.client.call('getMe', {}); expect(got.etag).toMatch(/^"/);
    const p1 = await t.client.call('updateMe', { body: { display_name: 'B' } }); expect(t.seen[1]!.headers['if-match']).toBe(got.etag); expect(p1.status).toBe(200);
    const other = t.client.withAuthProvider({ getAccessToken: async () => t.token() }); await other.call('updateMe', { body: { display_name: 'C' } }); /* someone else changes it */
    t.seen.length = 0; const e = await t.client.call('updateMe', { body: { display_name: 'D' } }).catch((x: unknown) => x);
    expect(t.seen[0]!.headers['if-match']).toBe(p1.etag); expect(e).toBeInstanceOf(ApiError); expect(e).toMatchObject({ status: 412, code: 'precondition_failed', attempts: 1 }); expect(t.seen).toHaveLength(1);
  });
  it('ifMatch from the caller wins; GET and POST never send If-Match; DELETE forgets the ETag', async () => {
    const { client, seen } = scripted([json(200, { id: 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4W', name: 'd', platform: 'linux', created_at: '2026-10-06T12:00:00.000Z', key_fingerprint: 'f' }, { etag: '"e1"' }), new Response(null, { status: 204 }), new Response(null, { status: 204 })]);
    const path = { id: 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4W' };
    await client.call('getDevice', { path }); expect(seen[0]!.headers['if-match']).toBeUndefined();
    await client.call('revokeDevice', { path }, { ifMatch: '"mine"' }); expect(seen[1]!.headers['if-match']).toBe('"mine"');
    await client.call('revokeDevice', { path }); expect(seen[2]!.headers['if-match']).toBeUndefined();
  });
  it('revalidate sends If-None-Match and reports 304 as notModified', async () => {
    const { client, seen } = scripted([new Response(null, { status: 304, headers: { etag: '"f3"' } }), json(200, FLAGS, { etag: '"f4"' })]);
    const a = await client.revalidate('getFlags', {}, '"f3"'); expect(a).toMatchObject({ notModified: true, etag: '"f3"', status: 304 }); expect(seen[0]!.headers['if-none-match']).toBe('"f3"');
    const b = await client.revalidate('getFlags', {}, '"f3"'); expect(b.notModified).toBe(false); if (!b.notModified) { expect(b.data.rev).toBe(3); expect(b.etag).toBe('"f4"'); }
    await expect(client.revalidate('updateMe' as never, { body: {} } as never, '"x"')).rejects.toThrow(TypeError);
  });
});

describe('rate limits and status', () => {
  it('RateLimit-* headers are parsed onto the result', async () => {
    const t = await onMock(); m = t.m; const r = await t.client.call('getMe', {});
    expect(r.rateLimit).toEqual({ limit: 600, remaining: 599, resetS: expect.any(Number) });
    expect(parseRateLimit(new Headers({ 'ratelimit-limit': '10', 'ratelimit-remaining': 'x', 'ratelimit-reset': '1' }))).toBeUndefined();
  });
  it('a client_too_old answer is an ApiError the caller can act on; the client does not exit or block', async () => {
    const t = await onMock({ userAgent: defaultUserAgent('0.0.1') }); m = t.m; await m.control('min-client', { version: '9.0.0' });
    expect(await t.client.call('getMe', {}).catch((x: unknown) => x)).toMatchObject({ code: 'client_too_old', status: 426, attempts: 1 });
    await m.control('min-client', {}); expect((await t.client.getStatus()).contract_version).toBeTypeOf('string');
  });
});

describe('logging', () => {
  it('logs method, path template, status, attempt, duration and request_id only: never tokens, bodies or concrete paths', async () => {
    const ring = createRingSink(); const logger = createLogger({ level: 'trace', sinks: [ring], clock: () => 0 });
    const SECRET_TOKEN = 'tok-SECRET-91'; const BODY = 'BODY-SECRET-55';
    const { client } = scripted([problem(503, 'service_unavailable', { detail: BODY }), json(200, { id: 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V4W', email: 'e', display_name: BODY, created_at: 'x', locale: 'en', telemetry: false })], { logger, getAccessToken: async () => SECRET_TOKEN });
    await client.call('updateMe', { body: { display_name: BODY } }).catch(() => undefined);
    await client.call('revokeDevice', { path: { id: 'dev_PRIVATE' } }).catch(() => undefined);
    const recs = ring.snapshot(); expect(recs.length).toBeGreaterThan(0); const text = JSON.stringify(recs);
    for (const s of [SECRET_TOKEN, BODY, 'dev_PRIVATE', 'Bearer']) expect(text).not.toContain(s);
    for (const r of recs) { expect(Object.keys(r).filter((k) => ! ['ts', 'level', 'component', 'msg', 'request_id', 'method', 'route', 'status', 'attempt', 'duration_ms', 'transport'].includes(k))).toEqual([]); expect(r.request_id).toMatch(REQ_RE); }
    expect(recs.some((r) => r.route === '/v1/devices/{id}')).toBe(true);
  });
});

describe('errors from fetch itself', () => {
  it('a DNS failure after the budget is TransportError(offline) and maps to the "Cannot reach the server" message', async () => {
    const dns = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    const { client } = scripted([dns]); const e = await client.call('getStatus', {}).catch((x: unknown) => x) as TransportError;
    expect(e.transport).toBe('offline'); expect(e.kind).toBe('network'); expect(e.requestId).toMatch(REQ_RE);
  });
});
