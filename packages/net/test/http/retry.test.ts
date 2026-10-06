import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import type { MockBackend } from '@centcom/testkit';
import { ApiError, MAX_TOTAL_SLEEP_MS, TransportError, httpRetryDecision, jitterDelayMs, retrySafe, type HttpClient } from '../../src/index.js';
import { FLAGS, inject, json, onMock, problem, scripted } from './helpers.js';

const USAGE = { events: [{ id: 'use_01JA3Z8K2M5N7P9Q0R1S2T3V4W', type: 'agent_minutes' as const, qty: 1, at: '2026-10-06T12:00:00.000Z' }] };
const USAGE_OK = { accepted: 1, duplicates: 0 };
type Mode = 'idempotent GET' | 'POST with key' | 'POST without key';
const MODES: Record<Mode, { ok: Response; run: (c: HttpClient) => Promise<unknown> }> = {
  'idempotent GET': { ok: json(200, FLAGS), run: (c) => c.call('getFlags', {}) },
  'POST with key': { ok: json(200, USAGE_OK), run: (c) => c.call('ingestUsageEvents', { body: USAGE }) },
  'POST without key': { ok: json(200, {}), run: (c) => c.call('revokeToken', { body: { token: 'rt_x' } }) },
};
/** The CT-ERR table. 401 here is a code that does not refresh. */
const TABLE: { status: number; code: string; retried: Record<Mode, boolean> }[] = [
  ...[[400, 'invalid_request'], [401, 'unauthorized'], [403, 'forbidden'], [404, 'not_found'], [409, 'conflict'], [410, 'gone'], [422, 'validation_failed']].map(([status, code]) => ({ status: status as number, code: code as string, retried: { 'idempotent GET': false, 'POST with key': false, 'POST without key': false } })),
  ...[[408, 'request_timeout'], [425, 'too_early'], [429, 'rate_limited']].map(([status, code]) => ({ status: status as number, code: code as string, retried: { 'idempotent GET': true, 'POST with key': true, 'POST without key': false } })),
  ...[[500, 'internal_error'], [502, 'bad_gateway'], [503, 'service_unavailable'], [504, 'timeout']].map(([status, code]) => ({ status: status as number, code: code as string, retried: { 'idempotent GET': true, 'POST with key': true, 'POST without key': false } })),
];

describe('the CT-ERR retry table', () => {
  for (const row of TABLE) for (const mode of Object.keys(MODES) as Mode[]) {
    it(`${row.status} on ${mode}: ${row.retried[mode] ? 'retried' : 'thrown after one attempt'}`, async () => {
      const { client, seen, clock } = scripted([problem(row.status, row.code), MODES[mode].ok]);
      const p = MODES[mode].run(client);
      if (row.retried[mode]) { await expect(p).resolves.toBeTruthy(); expect(seen).toHaveLength(2); expect(clock.sleeps()).toHaveLength(1); }
      else { const e = await p.catch((x: unknown) => x); expect(e).toBeInstanceOf(ApiError); expect(e).toMatchObject({ status: row.status, attempts: 1 }); expect(seen).toHaveLength(1); expect(clock.sleeps()).toHaveLength(0); }
    });
  }
  it('a PATCH without a key is retried on 429 but not on 503 (not idempotent)', () => {
    const rng = () => 0.5;
    expect(httpRetryDecision({ method: 'PATCH', hasIdempotencyKey: false, attempt: 1, status: 429 }, rng).retry).toBe(true);
    expect(httpRetryDecision({ method: 'PATCH', hasIdempotencyKey: false, attempt: 1, status: 503 }, rng)).toMatchObject({ retry: false, reason: 'not_idempotent' });
    expect(retrySafe('put', false)).toBe(true); expect(retrySafe('POST', false)).toBe(false); expect(retrySafe('POST', true)).toBe(true);
  });
  it('statuses outside the table (412, 413, 418) are never retried', () => {
    for (const status of [412, 413, 418, 501]) expect(httpRetryDecision({ method: 'GET', hasIdempotencyKey: false, attempt: 1, status }, Math.random).retry).toBe(false);
  });
});

describe('backoff', () => {
  it('full jitter: attempt n sleeps in [0, min(30000, 500 * 2^n)]', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 10 }), fc.double({ min: 0, max: 0.999999, noNaN: true }), (n, r) => { const d = jitterDelayMs(n, () => r); return d >= 0 && d <= Math.min(30_000, 500 * 2 ** n) && Number.isInteger(d); }));
  });
  it('a seeded rng gives the same sleeps every run, each within its bound', async () => {
    const run = async () => { const { client, clock, seen } = scripted([problem(503, 'service_unavailable'), problem(503, 'service_unavailable'), problem(503, 'service_unavailable'), json(200, FLAGS)]); await client.call('getFlags', {}); return { sleeps: clock.sleeps(), n: seen.length }; };
    const a = await run(); const b = await run();
    expect(a).toEqual(b); expect(a.n).toBe(4); a.sleeps.forEach((d, i) => { expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThanOrEqual(Math.min(30_000, 500 * 2 ** (i + 1))); });
  });
  it('honours Retry-After (header or retry_after_s) up to 30 s; above that the error goes to the caller', () => {
    expect(httpRetryDecision({ method: 'GET', hasIdempotencyKey: false, attempt: 1, status: 503, retryAfterS: 30 }, () => 0.9)).toMatchObject({ retry: true, delayMs: 30_000 });
    expect(httpRetryDecision({ method: 'GET', hasIdempotencyKey: false, attempt: 1, status: 503, retryAfterS: 31 }, () => 0.9)).toMatchObject({ retry: false, reason: 'retry_after_too_long' });
  });
  it('stops at 5 attempts and never sleeps more than 60 s in total', async () => {
    expect(httpRetryDecision({ method: 'GET', hasIdempotencyKey: false, attempt: 5, status: 503 }, () => 0)).toMatchObject({ retry: false, reason: 'max_attempts' });
    expect(httpRetryDecision({ method: 'GET', hasIdempotencyKey: false, attempt: 2, status: 503, retryAfterS: 20, sleptMs: 45_000 }, () => 0)).toMatchObject({ retry: false, reason: 'sleep_budget' });
    const { client, seen, clock } = scripted([problem(503, 'service_unavailable', { retry_after_s: 25 })]);
    const e = await client.call('getFlags', {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError); expect(seen).toHaveLength(3); expect(clock.sleeps().reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MAX_TOTAL_SLEEP_MS);
    const s2 = scripted([problem(500, 'internal_error')]); const e2 = await s2.client.call('getFlags', {}).catch((x: unknown) => x);
    expect(e2).toMatchObject({ attempts: 5, code: 'internal_error' }); expect(s2.seen).toHaveLength(5);
  });
  it('maxAttempts can lower the limit but not raise it', async () => {
    const a = scripted([problem(500, 'internal_error')], { maxAttempts: 2 }); await a.client.call('getFlags', {}).catch(() => undefined); expect(a.seen).toHaveLength(2);
    const b = scripted([problem(500, 'internal_error')], { maxAttempts: 50 }); await b.client.call('getFlags', {}).catch(() => undefined); expect(b.seen).toHaveLength(5);
  });
  it('a network failure is retried for a GET and becomes TransportError(offline) after the budget; never hangs', async () => {
    const fail = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    const { client, seen } = scripted([fail]); const e = await client.call('getFlags', {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TransportError); expect(e).toMatchObject({ transport: 'offline', kind: 'network', attempts: 5 }); expect(seen).toHaveLength(5);
    const post = scripted([fail]); await post.client.call('revokeToken', { body: {} }).catch(() => undefined); expect(post.seen).toHaveLength(1);
  });
});

describe('against the mock backend', () => {
  let m: MockBackend | undefined; afterEach(async () => { await m?.stop(); m = undefined; });
  it('a GET that answers 503 twice then 200 succeeds on attempt 3; every sleep is within the jitter bound and <= 30 s', async () => {
    const t = await onMock(); m = t.m; await inject(m, 'service_unavailable', { count: 2 });
    const r = await t.client.call('getMe', {});
    expect(r.status).toBe(200); expect(t.seen).toHaveLength(3); expect(t.clock.sleeps()).toHaveLength(2);
    t.clock.sleeps().forEach((d, i) => { expect(d).toBeLessThanOrEqual(30_000); expect(d).toBeLessThanOrEqual(Math.min(30_000, 500 * 2 ** (i + 1))); });
  });
  it('a POST without an Idempotency-Key in the contract (revokeToken) that gets 503 is thrown after 1 attempt', async () => {
    const t = await onMock(); m = t.m; await inject(m, 'service_unavailable');
    const e = await t.client.call('revokeToken', { body: { token: 'rt_whatever' } }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError); expect(e).toMatchObject({ status: 503, code: 'service_unavailable', attempts: 1 }); expect(t.seen).toHaveLength(1); expect(t.seen[0]!.headers['idempotency-key']).toBeUndefined();
  });
  it('400, 403, 404, 409, 410 and 422 are thrown at once with code and request_id kept', async () => {
    const t = await onMock(); m = t.m;
    for (const code of ['invalid_request', 'forbidden', 'not_found', 'conflict', 'gone', 'validation_failed']) {
      t.seen.length = 0; await inject(m, code); const e = await t.client.call('getMe', {}).catch((x: unknown) => x);
      expect(e, code).toBeInstanceOf(ApiError); expect(e).toMatchObject({ code, attempts: 1 }); expect((e as ApiError).requestId).toBe(t.seen[0]!.headers['x-request-id']); expect(t.seen).toHaveLength(1);
    }
    t.seen.length = 0; /* a body missing a required field: the mock's own validator answers 422 with pointers */
    const v = await t.client.call('createSession', { body: { name: 'x' } as never }).catch((x: unknown) => x) as ApiError;
    expect(v.status).toBe(422); expect(v.code).toBe('validation_failed'); expect(v.attempts).toBe(1); expect(v.fieldErrors.length).toBeGreaterThan(0); expect(typeof v.fieldErrors[0]!.pointer).toBe('string');
  });
  it('errors[].pointer survives on a 400 problem', async () => {
    const { client } = scripted([problem(400, 'invalid_request', { errors: [{ pointer: '/events/3/qty', code: 'out_of_range' }] })]);
    const e = await client.call('getFlags', {}).catch((x: unknown) => x) as ApiError;
    expect(e.fieldErrors).toEqual([{ pointer: '/events/3/qty', code: 'out_of_range' }]); expect(e.requestId).toBe('req_01JA3Z8K2M5N7P9Q0R1S2T3V4W'); expect(e.attempts).toBe(1);
  });
  it('429 with Retry-After: 2 waits exactly 2 s before the retry', async () => {
    const t = await onMock(); m = t.m; await inject(m, 'rate_limited', { retry_after_s: 2 });
    const r = await t.client.call('getMe', {}); expect(r.status).toBe(200); expect(t.clock.sleeps()).toEqual([2000]); expect(t.seen).toHaveLength(2);
  });
  it('429 quota_exceeded with retry_after_s 3600 is not slept; ApiError carries retryAfterS', async () => {
    const t = await onMock(); m = t.m; await inject(m, 'quota_exceeded', { retry_after_s: 3600 });
    const e = await t.client.call('getMe', {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError); expect(e).toMatchObject({ code: 'quota_exceeded', retryAfterS: 3600, attempts: 1 }); expect(t.clock.sleeps()).toEqual([]);
  });
});
