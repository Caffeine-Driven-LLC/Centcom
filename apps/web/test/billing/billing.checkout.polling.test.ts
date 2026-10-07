import { describe, expect, it } from 'vitest';
import { EntCache, pollEntitlements, startCheckout } from '../../shell/src/billing/data.js';
import { HttpErr, fakeHttp } from '../workspace/helpers.js';
import { baseEnt } from './setup.js';

const world = (revAt: number) => { let t = 0; let polls = 0; const http = fakeHttp(() => { polls++; return baseEnt({ rev: polls >= revAt ? 6 : 5 }); }); return { http, polls: () => polls, o: { now: () => t, sleep: async (ms: number) => { t += ms; } }, time: () => t }; };
describe('checkout (acceptance 6; failure modes)', () => {
  it('asks every 2 s until rev goes up, then reports the update', async () => { const w = world(4); expect(await pollEntitlements(w.http, 'w', 5, w.o)).toMatchObject({ state: 'updated', ent: { rev: 6 } }); expect(w.polls()).toBe(4); expect(w.time()).toBe(6000); });
  it('gives up after 30 s', async () => { const w = world(999); expect(await pollEntitlements(w.http, 'w', 5, w.o)).toEqual({ state: 'timeout' }); expect(w.time()).toBe(30_000); expect(w.polls()).toBe(16); });
  it('a failed ask is asked again, not fatal', async () => { let n = 0; const http = fakeHttp(() => { if (n++ < 2) throw new HttpErr('internal_error', 500); return baseEnt({ rev: 9 }); }); let t = 0; expect(await pollEntitlements(http, 'w', 5, { now: () => t, sleep: async (ms) => { t += ms; } })).toMatchObject({ state: 'updated' }); });
  it('checkout carries the Idempotency-Key and success and cancel addresses, and only an https address is followed', async () => {
    const http = fakeHttp(() => ({ url: 'https://checkout.example/s/1' })); expect(await startCheckout(http, 'w', { plan: 'pro', interval: 'month', seats: 3 }, 'https://app/billing?checkout=success', 'https://app/billing/plans', 'KEY')).toEqual({ ok: true, url: 'https://checkout.example/s/1' }); expect(http.calls[0]).toMatchObject({ op: 'createCheckout', o: { idempotencyKey: 'KEY' }, args: { id: 'w', body: { plan: 'pro', interval: 'month', seats: 3, success_url: 'https://app/billing?checkout=success', cancel_url: 'https://app/billing/plans' } } });
    expect((await startCheckout(fakeHttp(() => ({ url: 'javascript:alert(1)' })), 'w', { plan: 'pro', interval: 'month' }, 'a', 'b')).ok).toBe(false); expect((await startCheckout(fakeHttp(() => ({})), 'w', { plan: 'pro', interval: 'month' }, 'a', 'b')).ok).toBe(false);
  });
  it('a 403 and an idempotency conflict are told apart', async () => { expect(await startCheckout(fakeHttp(() => { throw new HttpErr('forbidden', 403); }), 'w', { plan: 'pro', interval: 'month' }, 'a', 'b')).toMatchObject({ ok: false, reason: 'forbidden' }); expect(await startCheckout(fakeHttp(() => { throw new HttpErr('idempotency_conflict', 409); }), 'w', { plan: 'pro', interval: 'month' }, 'a', 'b')).toEqual({ ok: false, reason: 'conflict' }); });
  it('the entitlement cache lasts 5 minutes, refetches when the token claim changes, and shows the last good values up to 24 h marked as of', () => { let now = 0; const c = new EntCache(() => now); c.put(baseEnt() as never); expect(c.fresh()).toBeTruthy(); expect(c.fresh(5)).toBeTruthy(); expect(c.fresh(6)).toBeUndefined(); now = 5 * 60_000 + 1; expect(c.fresh()).toBeUndefined(); expect(c.stale()).toMatchObject({ asOf: 0 }); now = 24 * 3_600_000 + 1; expect(c.stale()).toBeUndefined(); c.put(baseEnt() as never); c.invalidate(); expect(c.fresh()).toBeUndefined(); });
});
