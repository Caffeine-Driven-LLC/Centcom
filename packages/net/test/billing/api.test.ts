import { afterEach, describe, expect, it } from 'vitest';
import { VirtualClock, type MockBackend } from '@centcom/testkit';
import { ApiError, BILLING_WEB_URL, CouponInvalidError, EntitlementsClient, InvalidUrlError, NotAMemberError, createBillingApi, isAllowedBillingUrl } from '../../src/index.js';
import { json, problem, scripted } from '../http/helpers.js';
import { WSP, fixture, memLogger, mockWith, tmp } from '../support.js';

let m: MockBackend | undefined; afterEach(async () => { await m?.stop(); m = undefined; });
const KEY_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('checkout and portal URLs (AC8)', () => {
  it('checkout sends one POST with an Idempotency-Key; a retry of it reuses the key; the URL is returned, not opened', async () => {
    let first = true; const t = await mockWith([fixture('free')], {
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const r = await globalThis.fetch(input, init);
        if (first && init?.method === 'POST') { first = false; await r.arrayBuffer(); return problem(503, 'service_unavailable'); } /* the server did it, the answer was lost */
        return r;
      }) as typeof fetch,
    }); m = t.m;
    const opened: string[] = []; const c = new EntitlementsClient({ http: t.http, workspaceId: () => WSP, clock: new VirtualClock(), cacheDir: tmp('ent'), opener: async (u) => { opened.push(u); return true; } });
    const api = createBillingApi({ http: t.http });
    const r = await api.checkout(WSP, { plan: 'pro', seats: 2, currency: 'EUR' }); expect(r.url).toMatch(/^https:\/\//); expect(opened).toEqual([]);
    const sent = t.seen.filter((x) => x.method === 'POST'); expect(sent).toHaveLength(2); expect(sent[1]!.headers['idempotency-key']).toBe(sent[0]!.headers['idempotency-key']);
    const posts = t.m.state.idem; expect(posts.size).toBe(1); /* one stored request: the retry was a replay, not a second checkout */ const key = [...posts.keys()][0]!.split(':')[1]!; expect(key).toMatch(KEY_RE);
    expect(await c.openUrl(r.url)).toBe(true); expect(opened).toEqual([r.url]);
    const p = await api.portal(WSP, { returnUrl: 'https://centcom.dev/after' }); expect(p.url).toMatch(/^https:\/\//);
  });

  it('the retried POST carries the same Idempotency-Key and body (scripted)', async () => {
    const { client, seen } = scripted([problem(502, 'bad_gateway'), json(201, { url: 'https://pay.example/c/1' })]);
    const r = await createBillingApi({ http: client }).checkout(WSP, { plan: 'team', seats: 5 }); expect(r.url).toBe('https://pay.example/c/1');
    expect(seen).toHaveLength(2); expect(seen[0]!.headers['idempotency-key']).toMatch(KEY_RE); expect(seen[1]!.headers['idempotency-key']).toBe(seen[0]!.headers['idempotency-key']); expect(seen[1]!.body).toBe(seen[0]!.body);
    expect(JSON.parse(seen[0]!.body!)).toEqual({ plan: 'team', interval: 'month', seats: 5 });
  });

  it('a URL that is not https fails with InvalidUrlError (unless it is the dev base); openUrl refuses it too', async () => {
    for (const url of ['http://pay.example/c', 'javascript:alert(1)', 'centcom://billing', 'https://user:pw@pay.example/']) {
      const { client } = scripted([json(201, { url })]); const e = await createBillingApi({ http: client }).checkout(WSP, { plan: 'pro' }).catch((x: unknown) => x); expect(e, url).toBeInstanceOf(InvalidUrlError); expect(String((e as Error).message)).not.toContain(url);
    }
    const { client } = scripted([json(200, { url: 'http://127.0.0.1:4000/portal' })]); expect((await createBillingApi({ http: client, devBaseUrl: 'http://127.0.0.1:4000' }).portal(WSP)).url).toBe('http://127.0.0.1:4000/portal');
    expect(isAllowedBillingUrl('http://127.0.0.1:4001/x', 'http://127.0.0.1:4000')).toBe(false); expect(isAllowedBillingUrl('not a url')).toBe(false);
    const c = new EntitlementsClient({ http: null, workspaceId: () => null, clock: new VirtualClock(), cacheDir: tmp('ent'), opener: async () => true });
    await expect(c.openUrl('http://evil.example')).rejects.toBeInstanceOf(InvalidUrlError);
    expect(await new EntitlementsClient({ http: null, workspaceId: () => null, clock: new VirtualClock(), cacheDir: tmp('ent') }).openUrl('https://centcom.dev/billing')).toBe(false); /* no opener */
  });

  it('upgradeUrl: checkout for a free workspace, portal for a paid one, the web billing page when the API cannot help; opens only when asked', async () => {
    const opened: string[] = []; const opener = async (u: string) => { opened.push(u); return true; };
    const free = scripted([json(200, fixture('free')), json(201, { url: 'https://pay.example/checkout' })]);
    const a = new EntitlementsClient({ http: free.client, workspaceId: () => WSP, clock: new VirtualClock(), cacheDir: tmp('ent'), opener }); await a.get();
    expect(await a.upgradeUrl('relay_access')).toEqual({ url: 'https://pay.example/checkout', via: 'checkout', opened: false }); expect(opened).toEqual([]);
    expect(JSON.parse(free.seen[1]!.body!)).toMatchObject({ plan: 'pro' });
    const paid = scripted([json(200, fixture('pro')), json(200, { url: 'https://pay.example/portal' })]);
    const b = new EntitlementsClient({ http: paid.client, workspaceId: () => WSP, clock: new VirtualClock(), cacheDir: tmp('ent'), opener }); await b.get();
    expect(await b.upgradeUrl('max_seats', { open: true })).toEqual({ url: 'https://pay.example/portal', via: 'portal', opened: true }); expect(opened).toEqual(['https://pay.example/portal']);
    const denied = scripted([json(200, fixture('pro')), problem(403, 'forbidden')]);
    const c = new EntitlementsClient({ http: denied.client, workspaceId: () => WSP, clock: new VirtualClock(), cacheDir: tmp('ent') }); await c.get();
    expect(await c.upgradeUrl('relay_access')).toEqual({ url: BILLING_WEB_URL, via: 'fallback', opened: false });
    expect(await new EntitlementsClient({ http: null, workspaceId: () => null, clock: new VirtualClock(), cacheDir: tmp('ent') }).upgradeUrl('x')).toMatchObject({ via: 'fallback' });
  });
});

describe('seats (AC9)', () => {
  it('previewSeats PATCHes with ?preview=true and an Idempotency-Key and leaves the cache alone; setSeats commits and forces a refetch', async () => {
    const t = await mockWith([fixture('team')]); m = t.m;
    const c = new EntitlementsClient({ http: t.http, workspaceId: () => WSP, clock: new VirtualClock(), cacheDir: tmp('ent') }); await c.get();
    const gets = () => t.seen.filter((s) => s.method === 'GET' && s.url.pathname.endsWith('/entitlements')).length;
    const pv = await c.billing.previewSeats(WSP, 7); expect(pv.preview).toBe(true); expect(gets()).toBe(1);
    const patch = t.seen.filter((s) => s.method === 'PATCH'); expect(patch).toHaveLength(1); expect(patch[0]!.url.searchParams.get('preview')).toBe('true'); expect(patch[0]!.headers['idempotency-key']).toMatch(KEY_RE);
    await c.billing.setSeats(WSP, 7); const p2 = t.seen.filter((s) => s.method === 'PATCH'); expect(p2).toHaveLength(2); expect(p2[1]!.url.searchParams.has('preview')).toBe(false);
    expect(p2[1]!.headers['idempotency-key']).toMatch(KEY_RE); expect(p2[1]!.headers['idempotency-key']).not.toBe(p2[0]!.headers['idempotency-key']); expect(gets()).toBe(2);
    await expect(c.billing.previewSeats(WSP, 0)).rejects.toThrow(TypeError);
  });
});

describe('typed errors and reads', () => {
  it('coupon_invalid -> CouponInvalidError; not_a_member -> NotAMemberError; anything else stays an ApiError', async () => {
    const t = await mockWith(); m = t.m; const api = createBillingApi({ http: t.http });
    await t.m.control('errors', { code: 'coupon_invalid' }); const a = await api.redeemCoupon(WSP, 'NOPE').catch((x: unknown) => x); expect(a).toBeInstanceOf(CouponInvalidError); expect(a).toMatchObject({ code: 'coupon_invalid', status: 422 });
    await t.m.control('errors', { code: 'not_a_member' }); expect(await api.redeemCoupon(WSP, 'X').catch((x: unknown) => x)).toBeInstanceOf(NotAMemberError);
    await t.m.control('errors', { code: 'forbidden' }); const f = await api.redeemCoupon(WSP, 'X').catch((x: unknown) => x); expect(f).toBeInstanceOf(ApiError); expect(f).not.toBeInstanceOf(CouponInvalidError);
    await t.m.control('errors', { code: 'not_a_member' }); expect(await api.subscription(WSP).catch((x: unknown) => x)).toBeInstanceOf(NotAMemberError);
    await t.m.control('errors', { code: 'not_a_member' }); expect(await api.checkout(WSP, { plan: 'pro' }).catch((x: unknown) => x)).toBeInstanceOf(NotAMemberError);
    expect(await api.redeemCoupon(WSP, 'WELCOME')).toHaveProperty('status');
  });

  it('plans (public, no token needed), subscription, usage summary and every invoice page', async () => {
    const t = await mockWith([], { token: null }); m = t.m; const api = createBillingApi({ http: t.http });
    const plans = await api.plans(); expect(plans.length).toBeGreaterThan(0); expect(t.seen[0]!.headers.authorization).toBeUndefined();
    t.setToken(t.m.mintToken()); expect(await api.subscription(WSP)).toHaveProperty('status'); expect(await api.usageSummary(WSP)).toHaveProperty('items');
    let n = 0; for await (const inv of api.invoices(WSP)) { expect(inv).toHaveProperty('id'); n++; } expect(n).toBe(47);
    expect(t.seen.filter((s) => s.url.pathname.endsWith('/invoices')).length).toBe(1);
  });

  it('AC10: billing actions log nothing (no URLs, no invoice data); the entitlements log has plan, rev and status only', async () => {
    const log = memLogger(); const t = await mockWith([fixture('pro')], { logger: log }); m = t.m;
    const c = new EntitlementsClient({ http: t.http, workspaceId: () => WSP, clock: new VirtualClock(), cacheDir: tmp('ent'), logger: log });
    await c.get(); const r = await c.billing.checkout(WSP, { plan: 'team' }); for await (const _ of c.billing.invoices(WSP)) void _; await c.upgradeUrl('max_seats');
    const text = JSON.stringify(log.lines); expect(text).not.toContain(r.url); expect(text).not.toMatch(/https?:\/\/|amount|invoice_url|pdf/);
    const fetched = log.lines.find((l) => l.msg === 'entitlements.fetched')!; expect(fetched.ctx).toMatchObject({ plan: 'pro', rev: 42, status: 'active' });
  });
});
