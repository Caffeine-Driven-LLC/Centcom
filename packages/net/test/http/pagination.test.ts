import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import type { MockBackend } from '@centcom/testkit';
import { ApiError, checkPageLimit, type HttpClient, type PageItem } from '../../src/index.js';
import { json, onMock, scripted, type Seen } from './helpers.js';

const session = (i: number) => ({ id: `ses_01JA3Z8K2M5N7P9Q0R1S2T3V${'ABCDEFGHJKMNPQRSTVWXYZ0123456789'[Math.floor(i / 32)]}${'0123456789ABCDEFGHJKMNPQRSTVWXYZ'[i % 32]}`, name: `s${i}`, created_at: '2026-10-06T12:00:00.000Z', host: 'mem_01JA3Z8K2M5N7P9Q0R1S2T3V4W', policy: {}, region: 'eu', state: 'active', workspace: 'wsp_01JA3Z8K2M5N7P9Q0R1S2T3V4W' });
const all = Array.from({ length: 110 }, (_, i) => session(i));
/** Cursors with characters that need escaping in a query string: they must come back byte for byte. */
const CURSORS = ['c1+/=?&x', 'c2 ü%2F'];
const threePages = () => scripted([
  () => json(200, { data: all.slice(0, 50), next_cursor: CURSORS[0], has_more: true, _unknown: 'ignored' }),
  () => json(200, { data: all.slice(50, 100), next_cursor: CURSORS[1], has_more: true }),
  () => json(200, { data: all.slice(100), next_cursor: null, has_more: false }),
]);

describe('paginate and listPage (scripted)', () => {
  it('yields every item of a 3-page result in order, sends limit=50 by default, passes cursors back unchanged, never sends offset', async () => {
    const { client, seen } = threePages(); const got: string[] = [];
    for await (const s of client.paginate('listSessions', {})) got.push(s.id);
    expect(got).toEqual(all.map((s) => s.id)); expect(seen).toHaveLength(3);
    expect(seen.map((r) => r.url.searchParams.get('limit'))).toEqual(['50', '50', '50']);
    expect(seen.map((r) => r.url.searchParams.get('cursor'))).toEqual([null, ...CURSORS]);
    for (const r of seen) { expect(r.url.searchParams.has('offset')).toBe(false); expect(r.url.searchParams.has('fields')).toBe(false); }
  });
  it('does not fetch a page before the caller iterates into it', async () => {
    const { client, seen } = threePages(); const it = client.paginate('listSessions', {})[Symbol.asyncIterator]();
    expect(seen).toHaveLength(0); for (let i = 0; i < 50; i++) await it.next(); expect(seen).toHaveLength(1);
    await it.next(); expect(seen).toHaveLength(2); await it.return?.(); expect(seen).toHaveLength(2);
  });
  it('rejects limit 0 or 201 locally, with nothing sent', async () => {
    const { client, seen } = threePages();
    expect(() => client.paginate('listSessions', {}, { limit: 0 })).toThrow(RangeError); expect(() => client.paginate('listSessions', {}, { limit: 201 })).toThrow(RangeError);
    await expect(client.listPage('listSessions', { limit: 201 })).rejects.toThrow(RangeError); await expect(client.listPage('listSessions', { limit: 1.5 })).rejects.toThrow(RangeError);
    expect(seen).toHaveLength(0); expect(checkPageLimit(1)).toBe(1); expect(checkPageLimit(200)).toBe(200);
  });
  it('listPage returns one page with nextCursor and hasMore, and keeps filters', async () => {
    const { client, seen } = threePages();
    const p = await client.listPage('listSessions', { query: { state: 'active', mine: true }, limit: 50 });
    expect(p.data).toHaveLength(50); expect(p.nextCursor).toBe(CURSORS[0]); expect(p.hasMore).toBe(true);
    expect(seen[0]!.url.searchParams.get('state')).toBe('active'); expect(seen[0]!.url.searchParams.get('mine')).toBe('true');
    const p2 = await client.listPage('listSessions', { query: { state: 'active', mine: true }, cursor: p.nextCursor! });
    expect(seen[1]!.url.searchParams.get('cursor')).toBe(CURSORS[0]); expect(seen[1]!.url.searchParams.get('state')).toBe('active'); expect(p2.data[0]!.id).toBe(all[50]!.id);
    expectTypeOf<PageItem<'listSessions'>['id']>().toEqualTypeOf<string>();
  });
  it('an unknown query parameter (offset, fields) is refused before sending', async () => {
    const { client, seen } = threePages();
    await expect(client.listPage('listSessions', { query: { offset: 10 } as never })).rejects.toThrow(TypeError);
    await expect(client.call('listSessions', { query: { fields: 'id' } as never })).rejects.toThrow(TypeError); expect(seen).toHaveLength(0);
  });
});

describe('paginate against the mock backend', () => {
  let m: MockBackend; let client: HttpClient; let seen: Seen[]; let reference: string[]; let setToken: (t: string) => void;
  beforeAll(async () => { const t = await onMock(); m = t.m; client = t.client; seen = t.seen; setToken = t.setToken; reference = (await client.listPage('listSessions', { limit: 200 })).data.map((s) => s.id); });
  afterAll(async () => { await m.stop(); });

  it('any page size gives every item once, in the same order, with no offset parameter', async () => {
    expect(reference.length).toBeGreaterThan(20);
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 200 }), async (limit) => {
      seen.length = 0; const got: string[] = []; for await (const s of client.paginate('listSessions', {}, { limit })) got.push(s.id);
      expect(got).toEqual(reference); expect(seen).toHaveLength(Math.ceil(reference.length / limit));
      for (const r of seen) { expect(r.url.searchParams.get('limit')).toBe(String(limit)); expect(r.url.searchParams.has('offset')).toBe(false); }
    }), { numRuns: 25, seed: 7 });
  });
  it('an expired cursor stops the iteration with cursor_invalid; the caller restarts from page one', async () => {
    const it = client.paginate('listSessions', {}, { limit: 10 })[Symbol.asyncIterator](); for (let i = 0; i < 10; i++) await it.next();
    await m.advance(25 * 3600_000); setToken(m.mintToken()); /* only the cursor may be stale, not the access token */
    const e = await it.next().catch((x: unknown) => x); expect(e).toBeInstanceOf(ApiError); expect(e).toMatchObject({ code: 'cursor_invalid', status: 400, attempts: 1 });
    expect(await it.next()).toEqual({ done: true, value: undefined });
  });
});
