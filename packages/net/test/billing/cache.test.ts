import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VirtualClock, type MockBackend } from '@centcom/testkit';
import { ApiError, CentcomError, ContractViolationError, ENTITLEMENTS_TTL_MS, EntitlementsClient, NotAMemberError, OFFLINE_MAX_AGE_MS, TransportError, freshness, needsRefetch, type EntitlementsView } from '../../src/index.js';
import { json, scripted } from '../http/helpers.js';
import { WSP, WSP2, fixture, memLogger, mockWith, setEntitlement, tmp, until } from '../support.js';

let m: MockBackend | undefined; afterEach(async () => { await m?.stop(); m = undefined; });
const entGets = (seen: { url: URL; method: string }[]) => seen.filter((s) => s.method === 'GET' && s.url.pathname.endsWith('/entitlements')).length;
function fakeAuth(ent?: number) {
  const fns = new Set<() => void>(); let cur = ent;
  return { claims: () => (cur === undefined ? null : { ent: cur }), on: (_ev: 'ent-changed', fn: () => void) => { fns.add(fn); return () => { fns.delete(fn); }; }, set(n: number, fire = true) { cur = n; if (fire) fns.forEach((f) => f()); }, listeners: () => fns.size };
}
const apiError = (status: number, code: string) => new ApiError(new CentcomError({ kind: 'api', status }), code);

describe('freshness rules', () => {
  it('fresh up to 5 minutes, stale up to 24 hours, then expired; a clock that went back counts as stale', () => {
    expect(freshness({ fetchedAt: 0 }, ENTITLEMENTS_TTL_MS)).toBe('fresh'); expect(freshness({ fetchedAt: 0 }, ENTITLEMENTS_TTL_MS + 1)).toBe('stale');
    expect(freshness({ fetchedAt: 0 }, OFFLINE_MAX_AGE_MS)).toBe('stale'); expect(freshness({ fetchedAt: 0 }, OFFLINE_MAX_AGE_MS + 1)).toBe('expired'); expect(freshness({ fetchedAt: 10 }, 0)).toBe('stale');
  });
  it('needsRefetch: forced, invalidated, missing, stale, or a new ent claim (but not the same stale claim twice)', () => {
    const c = { ent: fixture('pro'), fetchedAt: 0 };
    expect(needsRefetch(undefined, 0)).toBe(true); expect(needsRefetch(c, 1)).toBe(false); expect(needsRefetch(c, 1, { force: true })).toBe(true); expect(needsRefetch(c, 1, { invalidated: true })).toBe(true);
    expect(needsRefetch(c, ENTITLEMENTS_TTL_MS + 1)).toBe(true); expect(needsRefetch(c, 1, { entClaim: 42 })).toBe(false); expect(needsRefetch(c, 1, { entClaim: 43 })).toBe(true);
    expect(needsRefetch({ ...c, claimAtFetch: 43 }, 1, { entClaim: 43 })).toBe(false);
  });
});

describe('EntitlementsClient cache and refresh triggers (against the mock)', () => {
  it('AC1: two get() within 5 minutes make one call; after 5 min + 1 s the next refetches; force always refetches', async () => {
    const t = await mockWith([fixture('pro')]); m = t.m; const clock = new VirtualClock();
    const c = new EntitlementsClient({ http: t.http, workspaceId: () => WSP, clock, cacheDir: tmp('ent') });
    const a = await c.get(); expect(a).toMatchObject({ source: 'network', stale: false }); expect(a.ent.plan).toBe('pro');
    await clock.advance(60_000); const b = await c.get(); expect(b.source).toBe('cache'); expect(entGets(t.seen)).toBe(1);
    await clock.advance(ENTITLEMENTS_TTL_MS - 60_000 + 1000); await c.get(); expect(entGets(t.seen)).toBe(2);
    await c.get({ force: true }); await c.get({ force: true }); expect(entGets(t.seen)).toBe(4);
  });

  it('AC2: when the token ent claim moves from 42 to 43 the next get() refetches inside the 5 minute window; ent-changed refetches by itself', async () => {
    const t = await mockWith([fixture('pro')]); m = t.m; const clock = new VirtualClock(); const auth = fakeAuth(42);
    const c = new EntitlementsClient({ http: t.http, auth, workspaceId: () => WSP, clock, cacheDir: tmp('ent') });
    expect((await c.get()).ent.rev).toBe(42); await c.get(); expect(entGets(t.seen)).toBe(1);
    await setEntitlement(t.m, { plan: 'team' }); auth.set(43, false);
    const v = await c.get(); expect(entGets(t.seen)).toBe(2); expect(v.ent.rev).toBe(43); expect(v.ent.plan).toBe('team');
    await c.get(); expect(entGets(t.seen)).toBe(2);
    auth.set(44); await until(() => entGets(t.seen) === 3); /* the event alone triggers it */
    /* the server is still at 43 while the token says 44: one refetch, not a loop */
    await c.get(); await c.get(); expect(entGets(t.seen)).toBe(3);
    c.close(); expect(auth.listeners()).toBe(0);
  });

  it('AC3: sys.notice plan_changed refetches within 1 s and onChange carries the new plan; a 429 entitlement_* triggers exactly one refetch', async () => {
    const t = await mockWith([fixture('pro')]); m = t.m; const clock = new VirtualClock();
    const c = new EntitlementsClient({ http: t.http, workspaceId: () => WSP, clock, cacheDir: tmp('ent') });
    await c.get(); const seen: EntitlementsView[] = []; c.onChange((v) => seen.push(v));
    await setEntitlement(t.m, { plan: 'team' });
    c.noticeHandler({ code: 'plan_changed', level: 'info', params: { plan: 'team' } });
    const ms = await until(() => seen.some((v) => v.ent.plan === 'team'), 1000); expect(ms).toBeLessThan(1000); expect(entGets(t.seen)).toBe(2);
    c.handleError(apiError(429, 'entitlement_limit_reached')); c.handleError(apiError(429, 'entitlement_limit_reached'));
    await until(() => entGets(t.seen) === 3); await new Promise((r) => setTimeout(r, 20)); expect(entGets(t.seen)).toBe(3);
    c.handleError(apiError(403, 'entitlement_required')); await until(() => entGets(t.seen) === 4);
    /* other errors are not entitlement signals */
    c.handleError(apiError(429, 'rate_limited')); c.handleError(apiError(400, 'entitlement_x')); c.handleError(new Error('x')); await new Promise((r) => setTimeout(r, 20)); expect(entGets(t.seen)).toBe(4);
  });

  it('AC4: with the mock stopped get() serves the cache: stale:false for 5 min, stale:true up to 24 h, then status none defaults; never throws', async () => {
    const t = await mockWith([fixture('pro')]); m = t.m; const clock = new VirtualClock(); const dir = tmp('ent');
    const c = new EntitlementsClient({ http: t.http, workspaceId: () => WSP, clock, cacheDir: dir });
    await c.get(); await t.m.stop(); m = undefined;
    await clock.advance(4 * 60_000); expect(await c.get()).toMatchObject({ stale: false, source: 'cache', ent: { plan: 'pro' } });
    await clock.advance(2 * 60_000); const s = await c.get(); expect(s).toMatchObject({ stale: true, source: 'cache', ent: { plan: 'pro' } }); expect(s.error).toBeInstanceOf(TransportError);
    expect(c.can('relay_access')).toBe(true);
    await clock.advance(23 * 3_600_000); expect(await c.get({ force: true })).toMatchObject({ stale: true, source: 'cache', ent: { plan: 'pro' } });
    await clock.advance(3_600_000); const d = await c.get({ force: true }); expect(d).toMatchObject({ stale: true, source: 'defaults', ent: { status: 'none', plan: 'free' } });
    expect(c.can('relay_access')).toBe(false); expect(c.can('lan_multiplayer')).toBe(true);
  });

  it('a restart inside 5 minutes serves the disk copy without the network; an unreadable copy is ignored and refetched', async () => {
    const t = await mockWith([fixture('team')]); m = t.m; const clock = new VirtualClock(); const dir = tmp('ent');
    await new EntitlementsClient({ http: t.http, workspaceId: () => WSP, clock, cacheDir: dir }).get();
    await until(() => existsSync(join(dir, 'entitlements', `${WSP}.json`)));
    const again = new EntitlementsClient({ http: t.http, workspaceId: () => WSP, clock, cacheDir: dir });
    expect(await again.get()).toMatchObject({ source: 'cache', stale: false, ent: { plan: 'team' } }); expect(entGets(t.seen)).toBe(1);
    writeFileSync(join(dir, 'entitlements', `${WSP}.json`), '{not json');
    const broken = new EntitlementsClient({ http: t.http, workspaceId: () => WSP, clock, cacheDir: dir });
    expect(await broken.get()).toMatchObject({ source: 'network' }); expect(entGets(t.seen)).toBe(2);
    /* a folder where the file should be: never blocks, never throws */
    const odd = tmp('ent'); mkdirSync(join(odd, 'entitlements', `${WSP}.json`), { recursive: true });
    expect((await new EntitlementsClient({ http: t.http, workspaceId: () => WSP, clock, cacheDir: odd }).get()).source).toBe('network');
  });

  it('AC10: the cache file holds the entitlements and the fetch time only: no token, no request data', async () => {
    const t = await mockWith([fixture('pro')]); m = t.m; const clock = new VirtualClock(); const dir = tmp('ent'); const log = memLogger();
    const c = new EntitlementsClient({ http: t.http, workspaceId: () => WSP, clock, cacheDir: dir, logger: log }); await c.get();
    const f = join(dir, 'entitlements', `${WSP}.json`); await until(() => existsSync(f)); const text = readFileSync(f, 'utf8'); const j = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(j).sort()).toEqual(['ent', 'fetchedAt', 'v']); expect(text).not.toMatch(/Bearer|eyJ|req_|token/i);
    for (const l of log.lines) for (const k of Object.keys(l.ctx)) expect(['component', 'plan', 'rev', 'status', 'request_id', 'code']).toContain(k);
    expect(JSON.stringify(log.lines)).not.toMatch(/limits|usage|hosted_minutes|wsp_/);
  });
});

describe('failure modes', () => {
  it('403 not_a_member clears that workspace cache and answers free defaults with a typed NotAMemberError', async () => {
    const t = await mockWith([fixture('pro')]); m = t.m; const clock = new VirtualClock(); const dir = tmp('ent');
    const c = new EntitlementsClient({ http: t.http, workspaceId: () => WSP, clock, cacheDir: dir }); await c.get();
    const f = join(dir, 'entitlements', `${WSP}.json`); await until(() => existsSync(f));
    await t.m.control('errors', { code: 'not_a_member' }); const v = await c.get({ force: true });
    expect(v.error).toBeInstanceOf(NotAMemberError); expect(v).toMatchObject({ source: 'defaults', ent: { status: 'none', plan: 'free' } }); expect(existsSync(f)).toBe(false); expect(c.can('relay_access')).toBe(false);
  });

  it('a response that fails the C003 schema keeps the previous cache and surfaces ContractViolationError (request_id only in the log)', async () => {
    const bad = { ...fixture('pro'), limits: { ...fixture('pro').limits, lan_multiplayer: false } }; const log = memLogger();
    const { client, seen } = scripted([json(200, fixture('pro')), json(200, bad), json(200, { ...fixture('pro'), workspace: WSP2 })]); const clock = new VirtualClock();
    const c = new EntitlementsClient({ http: client, workspaceId: () => WSP, clock, cacheDir: tmp('ent'), logger: log });
    await c.get(); const v = await c.get({ force: true }); expect(v.error).toBeInstanceOf(ContractViolationError); expect(v).toMatchObject({ source: 'cache', ent: { plan: 'pro' } }); expect(seen).toHaveLength(2);
    const w = await c.get({ force: true }); expect(w.error).toBeInstanceOf(ContractViolationError); expect((w.error as ContractViolationError).pointer).toBe('/workspace');
    const warn = log.lines.filter((l) => l.msg === 'entitlements.contract_violation'); expect(warn).toHaveLength(2); expect(Object.keys(warn[0]!.ctx).sort()).toEqual(['component', 'request_id']);
  });

  it('after a failure a non-forced get() serves the cache for 30 s before trying again', async () => {
    const { client, seen } = scripted([json(200, fixture('pro')), new TypeError('fetch failed')], { maxAttempts: 1 }); const clock = new VirtualClock();
    const c = new EntitlementsClient({ http: client, workspaceId: () => WSP, clock, cacheDir: tmp('ent') });
    await c.get(); await clock.advance(ENTITLEMENTS_TTL_MS + 1); await c.get(); expect(seen).toHaveLength(2);
    await c.get(); await clock.advance(10_000); await c.get(); expect(seen).toHaveLength(2); await clock.advance(21_000); await c.get(); expect(seen).toHaveLength(3);
  });

  it('a workspace switch keys the cache per workspace and discards a pending fetch for the old one', async () => {
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    let wsp = WSP; const changes: EntitlementsView[] = [];
    const { client } = scripted([async () => { await gate; return json(200, fixture('pro')); }, json(200, { ...fixture('team'), workspace: WSP2 })]); const clock = new VirtualClock();
    const c = new EntitlementsClient({ http: client, workspaceId: () => wsp, clock, cacheDir: tmp('ent') }); c.onChange((v) => changes.push(v));
    const old = c.get(); wsp = WSP2; release(); const r = await old; expect(r.ent.plan).toBe('pro'); expect(changes).toHaveLength(0); expect(c.can('relay_access')).toBe(false);
    const now = await c.get(); expect(now.ent.workspace).toBe(WSP2); expect(changes.map((v) => v.ent.plan)).toEqual(['team']);
  });

  it('no workspace or an id that is not a wsp_ id: defaults, no network, no file', async () => {
    const { client, seen } = scripted([json(200, fixture('pro'))]); const dir = tmp('ent');
    for (const w of [null, '../../etc/passwd', 'wsp_bad']) expect((await new EntitlementsClient({ http: client, workspaceId: () => w, clock: new VirtualClock(), cacheDir: dir }).get()).source).toBe('defaults');
    expect(seen).toHaveLength(0); expect(existsSync(join(dir, 'entitlements'))).toBe(false);
  });
});
