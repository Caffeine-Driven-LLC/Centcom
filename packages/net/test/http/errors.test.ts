import { describe, expect, it } from 'vitest';
import { ContractViolationError, TransportError, createHttpClient, userMessage } from '../../src/index.js';
import { AutoClock, FLAGS, UA, json, scripted } from './helpers.js';

const SECRET = 'BODY-SECRET-7f3a9c';
/** Nothing from the response body may reach the error: not the message, not the JSON form, not the cause. */
const noLeak = (e: unknown) => { const err = e as Error & { cause?: unknown }; expect(err.message).not.toContain(SECRET); expect(JSON.stringify(err)).not.toContain(SECRET); expect(String(err.cause ?? '')).not.toContain(SECRET); expect(String(err.stack ?? '')).not.toContain(SECRET); };
const hanging = (() => (_u: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => { init?.signal?.addEventListener('abort', () => rej(init.signal!.reason ?? new DOMException('aborted', 'AbortError'))); })) as unknown as () => typeof fetch;

describe('transport errors', () => {
  it('malformed JSON in a 200 is TransportError(bad_response), not retried, body not leaked', async () => {
    const { client, seen } = scripted([new Response(`{"flags": ${SECRET}`, { status: 200, headers: { 'content-type': 'application/json' } })]);
    const e = await client.call('getFlags', {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TransportError); expect(e).toMatchObject({ transport: 'bad_response', kind: 'protocol', status: 200, attempts: 1 }); expect(seen).toHaveLength(1); noLeak(e);
  });
  it("a proxy's HTML 502 is TransportError(bad_response) with the status; a GET retries it, then gives up", async () => {
    const html = new Response(`<html><body>502 Bad Gateway ${SECRET}</body></html>`, { status: 502, headers: { 'content-type': 'text/html', 'retry-after': '1' } });
    const { client, seen } = scripted([html]); const e = await client.call('getFlags', {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TransportError); expect(e).toMatchObject({ transport: 'bad_response', status: 502, attempts: 5, retryAfterS: 1 }); expect(seen).toHaveLength(5); noLeak(e);
    expect(userMessage(e as TransportError).title).toBe('The server sent something Centcom did not understand');
    const once = scripted([html, json(200, FLAGS)]); expect((await once.client.call('getFlags', {})).status).toBe(200);
  });
  it('a TLS failure is TransportError(tls) and is not retried', async () => {
    const tls = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' }) });
    const { client, seen } = scripted([tls]); const e = await client.call('getFlags', {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TransportError); expect(e).toMatchObject({ transport: 'tls', kind: 'network', attempts: 1 }); expect(seen).toHaveLength(1); noLeak(e);
  });
  it('an abort by the caller is TransportError(aborted), not retried, both in flight and while waiting to retry', async () => {
    const ac = new AbortController(); const clock = new AutoClock();
    const client = createHttpClient({ baseUrl: 'https://api.centcom.dev', getAccessToken: async () => 't', userAgent: UA, fetch: hanging(), clock, timeoutMs: 3_600_000 });
    const p = client.call('getFlags', {}, { signal: ac.signal }); setTimeout(() => ac.abort(), 5);
    const e = await p.catch((x: unknown) => x); expect(e).toBeInstanceOf(TransportError); expect(e).toMatchObject({ transport: 'aborted', kind: 'aborted', attempts: 1 });
    const slow = new AutoClock(1); /* nothing fires by itself, so the retry wait lasts until the abort */
    const ac2 = new AbortController(); const s = scripted([new Response('{}', { status: 503 })], { clock: slow });
    const p2 = s.client.call('getFlags', {}, { signal: ac2.signal }); await new Promise((r) => setTimeout(r, 10)); expect(s.seen).toHaveLength(1); ac2.abort();
    expect(await p2.catch((x: unknown) => x)).toMatchObject({ transport: 'aborted' }); expect(s.seen).toHaveLength(1);
    const ac3 = new AbortController(); ac3.abort(); const s3 = scripted([json(200, FLAGS)]);
    await expect(s3.client.call('getFlags', {}, { signal: ac3.signal })).rejects.toMatchObject({ transport: 'aborted' }); expect(s3.seen).toHaveLength(0);
  });
  it('the per-attempt timeout (15 s by default) ends a hung request; a GET tries 5 times then throws TransportError(timeout)', async () => {
    const clock = new AutoClock(); const client = createHttpClient({ baseUrl: 'https://api.centcom.dev', getAccessToken: async () => 't', userAgent: UA, fetch: hanging(), clock });
    const e = await client.call('getFlags', {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TransportError); expect(e).toMatchObject({ transport: 'timeout', kind: 'timeout', attempts: 5 }); expect(clock.delays.filter((d) => d === 15_000)).toHaveLength(5);
  });
  it('a 2xx body that breaks the contract is ContractViolationError with a pointer and no body; not retried', async () => {
    const { client, seen } = scripted([json(200, { flags: {}, rev: 'three', ttl_s: 60, note: SECRET })]);
    const e = await client.call('getFlags', {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ContractViolationError); expect(e).toMatchObject({ pointer: '/rev', operationId: 'getFlags', status: 200, kind: 'protocol' }); expect(seen).toHaveLength(1); noLeak(e);
    const missing = scripted([json(200, { flags: {}, ttl_s: 60 })]); expect(await missing.client.call('getFlags', {}).catch((x: unknown) => x)).toMatchObject({ pointer: '/rev' });
    const empty = scripted([new Response('', { status: 200 })]); expect(await empty.client.call('getFlags', {}).catch((x: unknown) => x)).toBeInstanceOf(ContractViolationError);
  });
  it('an unknown error code keeps its raw code and is handled by status class', async () => {
    const { client, seen } = scripted([new Response(JSON.stringify({ code: 'brand_new_code', status: 503, title: 'x', type: 'x', request_id: 'req_01JA3Z8K2M5N7P9Q0R1S2T3V4W', detail: 'short' }), { status: 503, headers: { 'content-type': 'application/problem+json' } }), json(200, FLAGS)]);
    expect((await client.call('getFlags', {})).status).toBe(200); expect(seen).toHaveLength(2);
    const t = scripted([new Response(JSON.stringify({ code: 'brand_new_code', status: 418 }), { status: 418, headers: { 'content-type': 'application/problem+json' } })]);
    expect(await t.client.call('getFlags', {}).catch((x: unknown) => x)).toMatchObject({ code: 'unknown', rawCode: 'brand_new_code', status: 418, attempts: 1 });
  });
});
