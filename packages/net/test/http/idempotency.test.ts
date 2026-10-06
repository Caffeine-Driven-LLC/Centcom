import { afterEach, describe, expect, it } from 'vitest';
import type { MockBackend } from '@centcom/testkit';
import { ApiError, isValidIdempotencyKey, newIdempotencyKey, wantsIdempotencyKey, HTTP_OPERATIONS } from '../../src/index.js';
import { json, onMock, problem, scripted, type Seen } from './helpers.js';

const usage = (n = 1) => ({ events: Array.from({ length: n }, (_, i) => ({ id: `use_01JA3Z8K2M5N7P9Q0R1S2T3V${String(i).padStart(2, '0').replace(/\d/g, (d) => 'ABCDEFGHJK'[Number(d)]!)}`, type: 'agent_minutes' as const, qty: 1, at: '2026-10-06T12:00:00.000Z' })) });
let m: MockBackend | undefined; afterEach(async () => { await m?.stop(); m = undefined; });

describe('Idempotency-Key', () => {
  it('a POST /v1/usage/events that gets 502 then 200 is retried with the same key and body; the mock ingests once and the retry is a replay', async () => {
    const seen: Seen[] = []; let first = true;
    const t = await onMock({
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        seen.push({ url: new URL(String(input)), method: init?.method ?? 'GET', headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body ? new TextDecoder().decode(init.body as Uint8Array) : undefined });
        const r = await globalThis.fetch(input, init);
        /* the backend did the work, then a proxy lost the answer */
        if (first) { first = false; await r.arrayBuffer(); return problem(502, 'bad_gateway'); }
        return r;
      }) as typeof fetch,
    });
    m = t.m;
    const r = await t.client.call('ingestUsageEvents', { body: usage(2) });
    expect(r.status).toBe(200); expect(r.replayed).toBe(true); expect(seen).toHaveLength(2);
    const k1 = seen[0]!.headers['idempotency-key']; expect(k1).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); expect(seen[1]!.headers['idempotency-key']).toBe(k1);
    expect(seen[1]!.body).toBe(seen[0]!.body); expect(seen[1]!.headers['x-request-id']).toBe(seen[0]!.headers['x-request-id']);
    expect([...m.state.idem.keys()].filter((k) => k.endsWith(':' + k1))).toHaveLength(1); expect(m.state.idem.size).toBe(1);
  });
  it('the key is stable across every retry of one logical request, and fresh for the next one', async () => {
    const { client, seen } = scripted([problem(503, 'service_unavailable'), problem(503, 'service_unavailable'), json(200, { accepted: 1, duplicates: 0 })]);
    await client.call('ingestUsageEvents', { body: usage() });
    expect(new Set(seen.map((s) => s.headers['idempotency-key'])).size).toBe(1); expect(new Set(seen.map((s) => s.body)).size).toBe(1);
    const k = seen[0]!.headers['idempotency-key']; await client.call('ingestUsageEvents', { body: usage() }); expect(seen[3]!.headers['idempotency-key']).not.toBe(k);
    expect(seen[3]!.headers['idempotency-key']! > k!).toBe(true); /* monotonic */
  });
  it('a caller-supplied key is used as is; a malformed one is refused before sending', async () => {
    const { client, seen } = scripted([json(200, { accepted: 1, duplicates: 0 })]);
    await client.call('ingestUsageEvents', { body: usage() }, { idempotencyKey: '0b9f6c3e-6d3a-4a43-9f5e-7c1d2e3f4a5b' }); expect(seen[0]!.headers['idempotency-key']).toBe('0b9f6c3e-6d3a-4a43-9f5e-7c1d2e3f4a5b');
    await expect(client.call('ingestUsageEvents', { body: usage() }, { idempotencyKey: 'x'.repeat(65) })).rejects.toThrow(TypeError);
    await expect(client.call('ingestUsageEvents', { body: usage() }, { idempotencyKey: 'bad key\r\n' })).rejects.toThrow(TypeError); expect(seen).toHaveLength(1);
    expect(isValidIdempotencyKey('01JA3Z8K2M5N7P9Q0R1S2T3V4W')).toBe(true); expect(newIdempotencyKey({ next: () => 'req_01JA3Z8K2M5N7P9Q0R1S2T3V4W' })).toBe('01JA3Z8K2M5N7P9Q0R1S2T3V4W');
  });
  it('only POSTs marked R or A get one automatically; GETs and unmarked POSTs never do', async () => {
    for (const [id, spec] of Object.entries(HTTP_OPERATIONS)) expect(wantsIdempotencyKey(spec), id).toBe(spec.method === 'POST' && spec.idempotency !== 'none');
    const { client, seen } = scripted([json(200, {})]); await client.call('revokeToken', { body: {} }); expect(seen[0]!.headers['idempotency-key']).toBeUndefined();
  });
  it('409 idempotency_conflict (same key, other body) is thrown without a retry', async () => {
    const t = await onMock(); m = t.m;
    await t.client.call('ingestUsageEvents', { body: usage(1) }, { idempotencyKey: 'K1' });
    t.seen.length = 0; const e = await t.client.call('ingestUsageEvents', { body: usage(2) }, { idempotencyKey: 'K1' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError); expect(e).toMatchObject({ status: 409, code: 'idempotency_conflict', attempts: 1 }); expect(t.seen).toHaveLength(1);
  });
  it('a replay (same key, same body) is surfaced as replayed === true, and a first answer as false', async () => {
    const t = await onMock(); m = t.m;
    const a = await t.client.call('ingestUsageEvents', { body: usage(1) }, { idempotencyKey: 'K2' }); const b = await t.client.call('ingestUsageEvents', { body: usage(1) }, { idempotencyKey: 'K2' });
    expect(a.replayed).toBe(false); expect(b.replayed).toBe(true); expect(b.data).toEqual(a.data);
  });
});
