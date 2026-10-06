import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_TABLE, type ErrorCode } from '@centcom/protocol';
import { CentcomError, LOCAL_MESSAGES, MAX_BODY_BYTES, MAX_FIELD_ERRORS, MESSAGES, backoffDelayMs, closeCodeAction, fromNetworkError, fromWsError, nextAction, parseProblem, parseRetryAfter, retryDecision, userMessage, wsBackoffMs } from '../src/index.js';

const REQ = 'req_01JA3Z8K2M5N7P9Q0R1S2T3V4W';
const res = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, bodyText: typeof body === 'string' ? body : JSON.stringify(body) });

describe('parseProblem', () => {
  it('reads a full problem+json body', () => {
    const e = parseProblem(res(429, { type: 'https://centcom.dev/errors/quota_exceeded', title: 'Quota exceeded', status: 429, code: 'quota_exceeded', detail: 'Used 100%.', request_id: REQ, retry_after_s: 3600 }));
    expect(e).toBeInstanceOf(CentcomError); expect(e).toMatchObject({ kind: 'api', code: 'quota_exceeded', status: 429, requestId: REQ, retryAfterS: 3600, detail: 'Used 100%.' });
  });
  it('does not throw on a proxy HTML page, an empty body or invalid JSON', () => {
    for (const body of ['<html>Bad gateway</html>', '', '{oops', '[]', '"text"', 'null']) { const e = parseProblem(res(502, body)); expect(e).toMatchObject({ kind: 'api', code: 'unknown', status: 502 }); }
  });
  it('takes the request id and retry-after from headers when the body has none', () => {
    const e = parseProblem(res(503, '<html>', { 'x-request-id': REQ, 'retry-after': '7' })); expect(e).toMatchObject({ requestId: REQ, retryAfterS: 7 });
  });
  it('ignores a malformed request id, and an unknown code becomes "unknown" but keeps the status', () => {
    const e = parseProblem(res(418, { code: 'teapot', status: 418, request_id: 'nope' })); expect(e).toMatchObject({ code: 'unknown', status: 418, requestId: undefined });
  });
  it('accepts a UTF-8 BOM and ignores bodies over 64 KiB', () => {
    expect(parseProblem(res(404, '﻿' + JSON.stringify({ code: 'not_found', status: 404 }))).code).toBe('not_found');
    expect(parseProblem(res(404, JSON.stringify({ code: 'not_found', status: 404, detail: 'x'.repeat(MAX_BODY_BYTES) }))).code).toBe('unknown');
  });
  it('caps field errors at 100 and drops malformed ones', () => {
    const errors = [...Array.from({ length: 150 }, (_, i) => ({ pointer: `/a/${i}`, code: 'bad' })), 'nope', { pointer: 5 }]; const e = parseProblem(res(422, { code: 'validation_failed', status: 422, errors }));
    expect(e.fieldErrors).toHaveLength(MAX_FIELD_ERRORS); expect(e.fieldErrors[0]).toEqual({ pointer: '/a/0', code: 'bad' });
  });
  it('parses Retry-After as seconds or an HTTP date, and ignores garbage', () => {
    const now = Date.parse('2026-10-05T18:00:00Z'); expect(parseRetryAfter('30')).toBe(30); expect(parseRetryAfter('Mon, 05 Oct 2026 18:01:00 GMT', now)).toBe(60); expect(parseRetryAfter('soon')).toBeUndefined(); expect(parseRetryAfter(null)).toBeUndefined(); expect(parseRetryAfter('99999999')).toBe(86400);
  });
  it('maps websocket and network failures', () => {
    expect(fromWsError({ code: 'queue_full', status: 429, request_id: REQ, retry_after_s: 2 })).toMatchObject({ code: 'queue_full', retryAfterS: 2 }); expect(fromWsError('x')).toMatchObject({ kind: 'protocol' });
    expect(fromNetworkError(Object.assign(new Error('x'), { name: 'AbortError' })).kind).toBe('aborted'); expect(fromNetworkError(Object.assign(new Error('x'), { name: 'TimeoutError' })).kind).toBe('timeout');
    expect(fromNetworkError(new Error('ECONNREFUSED')).kind).toBe('network'); expect(fromNetworkError({ cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }).kind).toBe('timeout');
  });
});

describe('retry table (CT-ERR): 14 statuses x GET / POST with key / POST without key = 42 cases', () => {
  const R = (status: number, method: string, key: boolean, extra: object = {}) => retryDecision({ status, method, hasIdempotencyKey: key, attempt: 1, authRefreshed: false, ...extra }).retry;
  const never = [400, 403, 404, 409, 410, 422], always = [408, 425, 429], idem = [500, 502, 503, 504];
  const cases: [number, string, boolean, boolean][] = [];
  for (const s of [400, 401, 403, 404, 408, 409, 410, 422, 425, 429, 500, 502, 503, 504]) for (const [m, k] of [['GET', false], ['POST', true], ['POST', false]] as [string, boolean][]) {
    const expected = s === 401 ? true /* refresh once */ : never.includes(s) ? false : always.includes(s) ? true : m === 'GET' || k;
    cases.push([s, m, k, expected]);
  }
  it.each(cases)('status %i %s key=%s -> retry %s', (s, m, k, expected) => { expect(R(s, m, k)).toBe(expected); });
  it('has 42 cases', () => { expect(cases).toHaveLength(42); });
  it('a 5xx on a POST without a key is never retried; with a key it is, up to 5 attempts', () => {
    expect(retryDecision({ status: 503, method: 'POST', hasIdempotencyKey: false, attempt: 1, authRefreshed: false })).toMatchObject({ retry: false, reason: 'not_idempotent' });
    for (let a = 1; a <= 4; a++) expect(retryDecision({ status: 503, method: 'POST', hasIdempotencyKey: true, attempt: a, authRefreshed: false }).retry).toBe(true);
    expect(retryDecision({ status: 503, method: 'POST', hasIdempotencyKey: true, attempt: 5, authRefreshed: false })).toMatchObject({ retry: false, reason: 'max_attempts' });
  });
  it('401 refreshes once, then stops; revoked and invalid tokens never retry', () => {
    expect(retryDecision({ status: 401, method: 'GET', hasIdempotencyKey: false, attempt: 1, authRefreshed: false, code: 'token_expired' })).toMatchObject({ retry: true, refreshAuth: true });
    expect(retryDecision({ status: 401, method: 'GET', hasIdempotencyKey: false, attempt: 2, authRefreshed: true, code: 'token_expired' }).retry).toBe(false);
    for (const code of ['token_revoked', 'token_invalid', 'device_revoked', 'refresh_reuse_detected']) expect(retryDecision({ status: 401, method: 'GET', hasIdempotencyKey: false, attempt: 1, authRefreshed: false, code }).retry, code).toBe(false);
  });
  it('does not sleep through a long Retry-After (it is shown instead)', () => {
    expect(retryDecision({ status: 429, method: 'POST', hasIdempotencyKey: false, attempt: 1, authRefreshed: false, retryAfterS: 3600 })).toMatchObject({ retry: false, reason: 'retry_after_too_long' });
    expect(retryDecision({ status: 429, method: 'POST', hasIdempotencyKey: false, attempt: 1, authRefreshed: false, retryAfterS: 3 }).retry).toBe(true);
  });
  it('any other status (200, 301, 418) is not retried', () => { for (const s of [200, 301, 418, 451]) expect(R(s, 'GET', true)).toBe(false); });
});

describe('backoff', () => {
  const seeded = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  it('stays within [0, 500 x 2^attempt] and never above 30 s', () => {
    expect(backoffDelayMs(3, undefined, () => 0.999999)).toBeLessThanOrEqual(4000); expect(backoffDelayMs(3, undefined, () => 0)).toBe(0);
    for (let a = 7; a < 30; a++) expect(backoffDelayMs(a, undefined, () => 0.999999)).toBeLessThanOrEqual(30_000);
  });
  it('honours Retry-After plus at most 500 ms of jitter', () => { for (const r of [0, 0.5, 0.999]) { const d = backoffDelayMs(2, 7, () => r); expect(d).toBeGreaterThanOrEqual(7000); expect(d).toBeLessThanOrEqual(7500); } });
  it('property: the ceiling never decreases with the attempt number and never passes the cap', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 40 }), (a) => backoffDelayMs(a, undefined, () => 0.999999) <= backoffDelayMs(a + 1, undefined, () => 0.999999) && backoffDelayMs(a, undefined, () => 0.999999) <= 30_000));
    fc.assert(fc.property(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 1, max: 1e6 }), (a, seed) => { const d = backoffDelayMs(a, undefined, seeded(seed)); return d >= 0 && d <= 30_000; }));
  });
  it('websocket reconnect: 250 ms x 2^n, cap 15 s', () => { expect(wsBackoffMs(0, () => 0.999999)).toBeLessThanOrEqual(250); expect(wsBackoffMs(3, () => 0.999999)).toBeLessThanOrEqual(2000); expect(wsBackoffMs(20, () => 0.999999)).toBeLessThanOrEqual(15_000); });
});

describe('websocket close codes', () => {
  it.each([
    [1000, 'reconnect', true], [1001, 'reconnect', true], [4400, 'stop', false], [4401, 'refresh_token', false], [4403, 'stop', false], [4404, 'stop', false],
    [4408, 'reconnect', true], [4409, 'stop', false], [4426, 'upgrade_required', false], [4429, 'reconnect', true], [4503, 'reconnect', true],
  ])('%i -> %s (backoff %s)', (code, action, backoff) => { expect(closeCodeAction(code)).toMatchObject({ action, backoff }); });
  it('4503 honours retry_after; unknown and abnormal closes reconnect slowly', () => { expect(closeCodeAction(4503).honourRetryAfter).toBe(true); for (const c of [4999, 4100, 1006, 1011]) expect(closeCodeAction(c)).toMatchObject({ action: 'reconnect', backoff: true }); });
  it('tells the user when retrying cannot help', () => { for (const c of [4403, 4404, 4426]) expect(closeCodeAction(c).tellUser).toBe(true); });
});

describe('messages', () => {
  it('has a message for every code in the registry (runtime half of the compile-time check)', () => {
    for (const c of ERROR_CODES) { const m = MESSAGES[c]; expect(m, c).toBeTruthy(); expect(m.title.length, c).toBeGreaterThan(3); }
    expect(Object.keys(MESSAGES).sort()).toEqual([...ERROR_CODES].sort());
  });
  it('the table type is exhaustive at compile time', () => { const missing: Exclude<ErrorCode, keyof typeof MESSAGES> extends never ? true : false = true; expect(missing).toBe(true); });
  it('messages are plain: no jargon codes, no blame, not too long', () => {
    for (const c of ERROR_CODES) { const m = MESSAGES[c]; expect(`${m.title} ${m.hint ?? ''}`, c).not.toMatch(/\b(4\d\d|5\d\d)\b|exception|stack|null|undefined/i); expect(m.title.length, c).toBeLessThanOrEqual(80); expect((m.hint ?? '').length, c).toBeLessThanOrEqual(190); }
    expect(Object.keys(LOCAL_MESSAGES).sort()).toEqual(['aborted', 'network', 'protocol', 'timeout']);
  });
  it('shows a ref only when there is a request id', () => {
    expect(userMessage(new CentcomError({ kind: 'api', code: 'not_found', status: 404, requestId: REQ })).ref).toBe(`Ref: ${REQ}`); expect(userMessage(new CentcomError({ kind: 'api', code: 'not_found', status: 404 })).ref).toBeUndefined();
  });
  it('unknown codes fall back to their HTTP class; local errors have their own text', () => {
    expect(userMessage(new CentcomError({ kind: 'api', code: 'unknown', status: 503 })).title).toMatch(/server/); expect(userMessage(new CentcomError({ kind: 'api', code: 'unknown', status: 401 })).hint).toMatch(/centcom login/);
    expect(userMessage(new CentcomError({ kind: 'network' })).title).toMatch(/Cannot reach/); expect(userMessage(new CentcomError({ kind: 'aborted' })).title).toBe('Cancelled');
  });
  it('never shows long detail, secrets, or URLs with query strings', () => {
    const long = userMessage(parseProblem(res(400, { code: 'invalid_request', status: 400, detail: 'x'.repeat(500) }))); expect(long.detail).toBeUndefined();
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const leaky = parseProblem(res(401, { code: 'token_invalid', status: 401, detail: `bad token ${jwt}` })); expect(JSON.stringify(userMessage(leaky))).not.toContain('eyJ'); expect(leaky.detail).not.toContain('eyJ'); expect(leaky.message).not.toContain('eyJ');
    const url = parseProblem(res(400, { code: 'invalid_request', status: 400, detail: 'see https://x.test/cb?token=abc123&x=1 for details' })); expect(url.detail).toBe('see https://x.test/cb for details'); expect(JSON.stringify(userMessage(url))).not.toMatch(/\?token/);
    const short = userMessage(parseProblem(res(409, { code: 'conflict', status: 409, detail: 'Someone edited it.' }))); expect(short.detail).toBe('Someone edited it.');
  });
});

describe('next action', () => {
  const E = (code: ErrorCode | 'unknown', status?: number) => new CentcomError({ kind: 'api', code, status });
  it.each([
    ['token_expired', 'refresh'], ['token_invalid', 'reauthenticate'], ['token_revoked', 'reauthenticate'], ['device_revoked', 'reauthenticate'], ['refresh_reuse_detected', 'reauthenticate'],
    ['client_too_old', 'upgrade'], ['quota_exceeded', 'show_quota'], ['forbidden', 'show_forbidden'], ['validation_failed', 'none'], ['rate_limited', 'none'],
  ] as const)('%s -> %s', (code, action) => { expect(nextAction(E(code, ERROR_TABLE[code].status))).toBe(code === 'rate_limited' ? 'retry' : action); });
  it('network trouble is worth retrying; an abort is not', () => { expect(nextAction(new CentcomError({ kind: 'network' }))).toBe('retry'); expect(nextAction(new CentcomError({ kind: 'timeout' }))).toBe('retry'); expect(nextAction(new CentcomError({ kind: 'aborted' }))).toBe('none'); });
  it('unknown codes use their status class', () => { expect(nextAction(E('unknown', 401))).toBe('reauthenticate'); expect(nextAction(E('unknown', 503))).toBe('retry'); expect(nextAction(E('unknown', 404))).toBe('none'); });
});

describe('known contract conflict: errors.json retryable:true codes the status table says never to retry', () => {
  const SIX = ['authorization_pending', 'slow_down', 'session_paused', 'lock_denied', 'key_required', 'export_not_ready'] as const;
  it('errors.json still marks exactly these 400/409 codes retryable (update docs/errors.md if this changes)', () => {
    const conflicting = ERROR_CODES.filter((c) => ERROR_TABLE[c].retryable && [400, 409].includes(ERROR_TABLE[c].status)).sort();
    expect(conflicting).toEqual([...SIX].sort());
  });
  it.each(SIX)('retryDecision does not auto-retry %s', (code) => {
    const status = ERROR_TABLE[code as ErrorCode].status;
    for (const method of ['GET', 'POST']) expect(retryDecision({ status, method, hasIdempotencyKey: true, attempt: 1, authRefreshed: false, code })).toMatchObject({ retry: false, reason: 'fix_the_request' });
  });
});
