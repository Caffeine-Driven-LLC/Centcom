import { describe, expect, it } from 'vitest';
import { VirtualClock } from '@centcom/testkit';
import type { Entitlements } from '@centcom/protocol';
import { ENTITLEMENTS_TTL_MS, EntitlementsClient, FREE_DEFAULT_LIMITS, KNOWN_LIMIT_KEYS, banner, can, defaultEntitlements, effectiveLimits, expired, limit, remaining, type EntitlementsView } from '../../src/index.js';
import { json, scripted } from '../http/helpers.js';
import { WSP, fixture, tmp } from '../support.js';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const BOOL = new Set(['relay_access', 'lan_multiplayer']);

describe('gates over the free, pro and team fixtures', () => {
  for (const name of ['free', 'pro', 'team']) {
    it(`${name}: limit() returns every key as the fixture has it; can() follows the value (null = unlimited, 0 = none)`, () => {
      const e = fixture(name);
      for (const k of KNOWN_LIMIT_KEYS) {
        const v = e.limits[k]; expect(limit(e, k, NOW), k).toEqual(v);
        const want = k === 'lan_multiplayer' ? true : BOOL.has(k) ? v === true : v === null || (typeof v === 'number' && v > 0);
        expect(can(e, k, NOW), k).toBe(want);
      }
    });
  }
  it('relay_access: false on free, true on pro and team (CT-ENTITLEMENTS §3)', () => {
    expect(can(fixture('free'), 'relay_access', NOW)).toBe(false); expect(can(fixture('pro'), 'relay_access', NOW)).toBe(true); expect(can(fixture('team'), 'relay_access', NOW)).toBe(true);
  });
  it('an unknown key is "unknown" for can(), never true, even when its value looks permissive; limit() still shows it', () => {
    const e = { ...fixture('team'), limits: { ...fixture('team').limits, future_feature: true, future_count: null } } as Entitlements;
    for (const k of ['future_feature', 'future_count', 'nope', '__proto__', 'constructor']) expect(can(e, k, NOW)).toBe('unknown');
    expect(limit(e, 'future_feature', NOW)).toBe(true); expect(limit(e, 'future_count', NOW)).toBeNull(); expect(limit(e, 'nope', NOW)).toBeUndefined();
  });
  it('remaining(): limit - usage, never below 0; null limit (unlimited) is null; no usage counts as 0', () => {
    const pro = fixture('pro'); expect(remaining(pro, 'hosted_minutes_month', NOW)).toBe(6000 - 4900); expect(remaining(pro, 'queue_items_month', NOW)).toBeNull();
    expect(remaining(fixture('team'), 'hosted_minutes_month', NOW)).toBe(30_000); expect(remaining(fixture('free'), 'hosted_minutes_month', NOW)).toBe(0);
    expect(remaining({ ...pro, usage: { hosted_minutes_month: 9999 } }, 'hosted_minutes_month', NOW)).toBe(0);
    expect(remaining({ ...pro, limits: { ...pro.limits, queue_items_month: 500 }, usage: { queue_items_month: 212 } }, 'queue_items_month', NOW)).toBe(288);
  });
  it('nothing known (null) means the free defaults; lan_multiplayer is still true', () => {
    expect(effectiveLimits(null, NOW)).toEqual(FREE_DEFAULT_LIMITS); expect(can(null, 'relay_access', NOW)).toBe(false); expect(can(null, 'lan_multiplayer', NOW)).toBe(true);
    expect(defaultEntitlements(WSP)).toMatchObject({ workspace: WSP, status: 'none', plan: 'free', rev: 0 });
  });
});

describe('status rules and the banner matrix', () => {
  const pastDue = fixture('past_due'); const grace = Date.parse(pastDue.grace_until!);
  const canceled = { ...fixture('pro'), status: 'canceled', warnings: [] } as Entitlements; const end = Date.parse(canceled.period!.end!);
  it('past_due keeps its entitlements until grace_until, then counts as none', () => {
    expect(expired(pastDue, grace - 1)).toBe(false); expect(can(pastDue, 'relay_access', grace - 1)).toBe(true);
    expect(expired(pastDue, grace)).toBe(true); expect(can(pastDue, 'relay_access', grace)).toBe(false); expect(effectiveLimits(pastDue, grace)).toEqual(FREE_DEFAULT_LIMITS);
    expect(expired({ ...pastDue, grace_until: null }, grace + 1e9)).toBe(false); /* no date: the server decides */
  });
  it('canceled keeps its limits until period.end, then counts as none', () => {
    expect(can(canceled, 'relay_access', end - 1)).toBe(true); expect(limit(canceled, 'max_concurrent_sessions', end - 1)).toBe(2);
    expect(can(canceled, 'relay_access', end)).toBe(false); expect(remaining(canceled, 'hosted_minutes_month', end)).toBe(0);
  });
  const rows: [string, Entitlements | null, Parameters<typeof banner>[2], ReturnType<typeof banner>][] = [
    ['active, no warnings', fixture('team'), undefined, { kind: 'none' }],
    ['nothing known', null, undefined, { kind: 'none' }],
    ['status none', defaultEntitlements(WSP), undefined, { kind: 'none' }],
    ['active with an 80 % warning', fixture('pro'), undefined, { kind: 'quota_warning', pct: 80 }],
    ['a warning at 100 %', { ...fixture('pro'), warnings: [{ limit: 'hosted_minutes_month', pct: 100 }] }, undefined, { kind: 'quota_reached', pct: 100 }],
    ['quota_reached notice', fixture('team'), { level: 'reached' }, { kind: 'quota_reached', pct: 100 }],
    ['usage_warning notice', fixture('team'), { level: 'warning', pct: 90 }, { kind: 'quota_warning', pct: 90 }],
    ['past_due', pastDue, { level: 'reached' }, { kind: 'past_due', graceUntil: pastDue.grace_until! }],
    ['canceled', canceled, undefined, { kind: 'canceled', periodEnd: canceled.period!.end! }],
  ];
  for (const [name, e, n, want] of rows) it(`banner: ${name}`, () => { expect(banner(e, NOW, n)).toEqual(want); });
});

describe('EntitlementsClient gates (AC5 to AC7)', () => {
  const client = (bodies: unknown[]) => { const s = scripted(bodies.map((b) => json(200, b))); const clock = new VirtualClock(Date.parse('2026-10-06T12:00:00.000Z')); return { ...s, clock, c: new EntitlementsClient({ http: s.client, workspaceId: () => WSP, clock, cacheDir: tmp('ent') }) }; };

  it('AC5: free fixture -> relay_access false; pro -> true; unknown keys are "unknown"; lan_multiplayer true throughout', async () => {
    const f = client([fixture('free')]); expect(f.c.can('lan_multiplayer')).toBe(true); await f.c.get(); expect(f.c.can('relay_access')).toBe(false); expect(f.c.can('mystery_key')).toBe('unknown');
    const p = client([fixture('pro')]); await p.c.get(); expect(p.c.can('relay_access')).toBe(true); expect(p.c.can('lan_multiplayer')).toBe(true); expect(p.c.can('mystery_key')).not.toBe(true);
  });

  it('AC6: past_due -> banner past_due with graceUntil, entitlements unchanged until grace_until, then none; canceled keeps limits until period.end', async () => {
    const pd = fixture('past_due'); const t = client([pd]); await t.c.get();
    expect(t.c.banner()).toEqual({ kind: 'past_due', graceUntil: pd.grace_until }); expect(t.c.can('relay_access')).toBe(true);
    await t.clock.advance(Date.parse(pd.grace_until!) - t.clock.now() - ENTITLEMENTS_TTL_MS / 2); await t.c.get(); expect(t.c.can('relay_access')).toBe(true);
    await t.clock.advance(ENTITLEMENTS_TTL_MS); await t.c.get(); expect(t.c.can('relay_access')).toBe(false); expect(t.c.limit('max_parallel_agents')).toBe(4); expect(t.c.banner().kind).toBe('past_due');
    const cn = { ...fixture('team'), status: 'canceled' }; const u = client([cn]); await u.c.get(); expect(u.c.banner()).toEqual({ kind: 'canceled', periodEnd: cn.period!.end });
    expect(u.c.limit('max_concurrent_sessions')).toBe(10);
    await u.clock.advance(Date.parse(cn.period!.end!) - u.clock.now()); await u.c.get(); expect(u.c.limit('max_concurrent_sessions')).toBe(0); expect(u.c.can('relay_access')).toBe(false);
  });

  it('AC7: warnings reach onChange; remaining() is limit - usage; queue_items_month null -> null (unlimited)', async () => {
    const t = client([fixture('pro')]); const views: EntitlementsView[] = []; t.c.onChange((v) => views.push(v)); await t.c.get();
    expect(views).toHaveLength(1); expect(views[0]!.ent.warnings).toEqual([{ limit: 'hosted_minutes_month', pct: 80 }]);
    expect(t.c.remaining('hosted_minutes_month')).toBe(1100); expect(t.c.remaining('queue_items_month')).toBeNull(); expect(t.c.banner()).toEqual({ kind: 'quota_warning', pct: 80 });
  });

  it('usage_warning and quota_reached notices become UI events until resets_at; a later warning does not hide a reached quota', async () => {
    const t = client([fixture('team'), { ...fixture('team'), rev: 43 }]); await t.c.get(); const views: EntitlementsView[] = []; t.c.onChange((v) => views.push(v));
    const resets = new Date(t.clock.now() + 3_600_000).toISOString();
    t.c.noticeHandler({ code: 'usage_warning', level: 'warn', params: { pct: 80, resets_at: resets } }); expect(t.c.banner()).toEqual({ kind: 'quota_warning', pct: 80 }); expect(views).toHaveLength(1);
    t.c.noticeHandler({ code: 'quota_reached', level: 'error', params: { resets_at: resets } }); expect(t.c.banner().kind).toBe('quota_reached'); expect(views).toHaveLength(2);
    t.c.noticeHandler({ code: 'usage_warning', params: { pct: 90 } }); expect(t.c.banner().kind).toBe('quota_reached');
    t.c.noticeHandler({ code: 'maintenance_soon', params: {} }); t.c.noticeHandler({ code: 'usage_warning', params: 'junk' as never }); expect(t.c.banner().kind).toBe('quota_reached');
    await t.clock.advance(3_600_000); expect(t.c.banner()).toEqual({ kind: 'none' });
  });

  it('a listener that throws does not stop the others; unsubscribe works', async () => {
    const t = client([fixture('pro'), { ...fixture('team') }]); const got: string[] = [];
    t.c.onChange(() => { throw new Error('boom'); }); const off = t.c.onChange((v) => got.push(v.ent.plan)); await t.c.get(); off(); await t.c.get({ force: true }); expect(got).toEqual(['pro']);
  });
});
