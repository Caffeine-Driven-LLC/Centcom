import { afterEach, describe, expect, it } from 'vitest';
import type { MockBackend } from '../src/index.js';
import { api, login, start } from './helpers.js';

let m: MockBackend; afterEach(async () => { await m?.stop(); });
const WSP = '/v1/workspaces/wsp_01JTEST0000000000000000001';

describe('ETag and If-Match (AC10)', () => {
  it('reads carry a stable ETag; a write with a stale or unknown If-Match is 412 precondition_failed; a matching one succeeds and moves the ETag', async () => {
    m = await start(); const { access_token: token } = await login(m);
    const r1 = await api(m, 'GET', WSP, { token }); const r2 = await api(m, 'GET', WSP, { token });
    const tag = r1.headers.get('etag')!; expect(tag).toMatch(/^"[0-9a-f]{16}"$/); expect(r2.headers.get('etag')).toBe(tag); expect(r2.body).toEqual(r1.body);
    const stale = await api(m, 'PATCH', WSP, { token, body: { name: 'Renamed' }, headers: { 'if-match': '"0000000000000000"' } });
    expect(stale.status).toBe(412); expect(stale.body.code).toBe('precondition_failed'); expect(stale.headers.get('content-type')).toContain('application/problem+json');
    const ok = await api(m, 'PATCH', WSP, { token, body: { name: 'Renamed' }, headers: { 'if-match': tag } });
    expect(ok.status).toBe(200); expect(ok.body.name).toBe('Renamed'); const tag2 = ok.headers.get('etag')!; expect(tag2).not.toBe(tag);
    expect((await api(m, 'PATCH', WSP, { token, body: { name: 'Again' }, headers: { 'if-match': tag } })).status).toBe(412); /* the old version is gone */
    const after = await api(m, 'GET', WSP, { token }); expect(after.body.name).toBe('Renamed'); expect(after.headers.get('etag')).toBe(tag2);
    expect((await api(m, 'PATCH', WSP, { token, body: { name: 'Star' }, headers: { 'if-match': '*' } })).status).toBe(200);
  });
  it('If-Match on a resource never read is refused; writes without If-Match are allowed; DELETE honours it too', async () => {
    m = await start(); const { access_token: token } = await login(m);
    expect((await api(m, 'PATCH', '/v1/workspaces/wsp_01JTEST0000000000000000002', { token, body: { name: 'X' }, headers: { 'if-match': '"abc"' } })).status).toBe(412);
    expect((await api(m, 'PATCH', WSP, { token, body: { name: 'NoTag' } })).status).toBe(200);
    const tag = (await api(m, 'GET', WSP, { token })).headers.get('etag')!;
    expect((await api(m, 'DELETE', WSP, { token, headers: { 'if-match': '"ffffffffffffffff"' } })).status).toBe(412);
    expect((await api(m, 'DELETE', WSP, { token, headers: { 'if-match': tag } })).status).toBeLessThan(300);
  });
});

describe('pagination (AC10)', () => {
  it('the same request gives the same page and cursor; pages are disjoint and cover the list; limit is enforced', async () => {
    m = await start(); const { access_token: token } = await login(m);
    const a = await api(m, 'GET', '/v1/workspaces?limit=10', { token }); const b = await api(m, 'GET', '/v1/workspaces?limit=10', { token });
    expect(a.body.next_cursor).toBeTruthy(); expect(b.body.next_cursor).toBe(a.body.next_cursor); expect(b.body.data).toEqual(a.body.data);
    const seen: string[] = a.body.data.map((x: unknown) => JSON.stringify(x)); let cur = a.body.next_cursor;
    while (cur) { const p = await api(m, 'GET', `/v1/workspaces?limit=10&cursor=${cur}`, { token }); const again = await api(m, 'GET', `/v1/workspaces?limit=10&cursor=${cur}`, { token }); expect(again.body).toEqual(p.body); expect(p.body.data.length).toBeLessThanOrEqual(10); seen.push(...p.body.data.map((x: unknown) => JSON.stringify(x))); cur = p.body.next_cursor; if (!cur) expect(p.body.has_more).toBe(false); }
    expect(new Set(seen).size).toBe(seen.length); expect(seen.length).toBe(47);
    expect((await api(m, 'GET', '/v1/workspaces?limit=0', { token })).body.code).toBe('invalid_request'); expect((await api(m, 'GET', '/v1/workspaces?limit=200', { token })).status).toBe(200);
  });
});
