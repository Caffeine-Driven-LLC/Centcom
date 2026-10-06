import { afterEach, describe, expect, it } from 'vitest';
import type { MockBackend } from '@centcom/testkit';
import { MIN_REQUEST_GAP_MS, USAGE_MAX_BATCH_BYTES, UsageSpool, cleanEvent } from '../../src/index.js';
import { AutoClock, problem } from '../http/helpers.js';
import { SES, mockWith, tmp } from '../support.js';
import { bodyOf, build, ev, ids, ok, scriptedReporter } from './helpers.js';

let m: MockBackend | undefined; afterEach(async () => { await m?.stop(); m = undefined; });
const USE_RE = /^use_[0-9A-HJKMNP-TV-Z]{26}$/;

describe('batching', () => {
  it('AC1 + AC11: 1,250 events -> 3 POSTs of 500, 500 and 250, each <= 1 MiB with its own Idempotency-Key; the mock ingests all 1,250 once', async () => {
    const t = await mockWith(); m = t.m; const { r } = build(t.http, new AutoClock());
    for (let i = 0; i < 1250; i++) r.record(ev(i));
    expect(await r.flush()).toEqual({ sent: 1250, kept: 0 });
    const posts = t.seen.filter((s) => s.method === 'POST'); expect(posts.map((p) => bodyOf(p).events.length)).toEqual([500, 500, 250]);
    for (const p of posts) expect(Buffer.byteLength(p.body!)).toBeLessThanOrEqual(USAGE_MAX_BATCH_BYTES);
    expect(new Set(posts.map((p) => p.headers['idempotency-key'])).size).toBe(3); expect(t.m.state.idem.size).toBe(3);
    const all = posts.flatMap((p) => bodyOf(p).events.map((e) => e.id)); expect(new Set(all).size).toBe(1250); for (const id of all) expect(id).toMatch(USE_RE);
    expect([...all].sort()).toEqual(all); /* monotonic ULIDs, oldest first */
  });

  it('maxBatch is honoured (and capped at 500); a body is cut before it passes the byte limit', async () => {
    const small = scriptedReporter([ok()], { maxBatch: 100 }); for (let i = 0; i < 250; i++) small.r.record(ev(i)); await small.r.flush(); expect(small.posts().map((p) => bodyOf(p).events.length)).toEqual([100, 100, 50]);
    const big = scriptedReporter([ok()], { maxBatch: 2000 }); for (let i = 0; i < 600; i++) big.r.record(ev(i)); await big.r.flush(); expect(big.posts().map((p) => bodyOf(p).events.length)).toEqual([500, 100]);
    const clock = new AutoClock(); const sp = new UsageSpool(tmp('usage')); const g = ids(clock);
    for (let i = 0; i < 50; i++) sp.append(cleanEvent({ id: g.next('use'), ...ev(i) })!);
    const one = JSON.stringify(cleanEvent({ id: g.next('use'), ...ev(1) })).length;
    const b = sp.next(500, 13 + one * 3 + 2, () => 'K1')!; expect(b.events).toHaveLength(3); expect(b.bytes).toBeLessThanOrEqual(13 + one * 3 + 2);
    expect(sp.next(500, USAGE_MAX_BATCH_BYTES, () => 'K2')!.key).toBe('K1'); /* the keyed batch comes back unchanged until it is acknowledged */
    sp.ack('K1'); expect(sp.next(10, USAGE_MAX_BATCH_BYTES, () => 'K3')!.events).toHaveLength(10);
  });

  it('a kept batch is resent later with the same key and the same body', async () => {
    const { r, posts, clock } = scriptedReporter([problem(503, 'service_unavailable'), problem(503, 'service_unavailable'), problem(503, 'service_unavailable'), problem(503, 'service_unavailable'), problem(503, 'service_unavailable'), ok(3)]);
    for (let i = 0; i < 3; i++) r.record(ev(i));
    expect(await r.flush()).toEqual({ sent: 0, kept: 3 }); expect(posts()).toHaveLength(5);
    r.record(ev(99)); clock.t += 10 * 60_000;
    expect(await r.flush()).toEqual({ sent: 4, kept: 0 });
    const p = posts(); expect(p).toHaveLength(7); expect(new Set(p.slice(0, 6).map((x) => x.headers['idempotency-key'])).size).toBe(1); expect(new Set(p.slice(0, 6).map((x) => x.body)).size).toBe(1);
    expect(bodyOf(p[6]!).events).toHaveLength(1); expect(p[6]!.headers['idempotency-key']).not.toBe(p[0]!.headers['idempotency-key']); /* the new event was not merged into the kept batch */
  });

  it('AC5: 400 batches (200,000 events) take at least 6 simulated minutes and never pass 60 requests in any minute', async () => {
    const clock = new AutoClock(); const starts: number[] = []; let recorded = 0; let throttled = 0;
    const t = scriptedReporter([() => {
      const now = clock.now(); starts.push(now); const inWindow = starts.filter((s) => s > now - 60_000).length;
      if (inWindow > 60) { throttled++; return problem(429, 'rate_limited', { retry_after_s: 1 }); }
      for (let i = 0; i < 500 && recorded < 200_000; i++, recorded++) t.r.record(ev(recorded)); /* keep the spool fed while it drains */
      return ok(500);
    }], { clock });
    for (; recorded < 9_500; recorded++) t.r.record(ev(recorded)); /* 9,500 waiting + 500 in flight = the 10,000 cap */
    const t0 = clock.now(); const res = await t.r.flush();
    expect(res).toEqual({ sent: 200_000, kept: 0 }); expect(throttled).toBe(0); expect(starts).toHaveLength(400);
    expect(clock.now() - t0).toBeGreaterThanOrEqual(6 * 60_000);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(MIN_REQUEST_GAP_MS);
    expect(t.r.dropped).toBe(0);
  }, 60_000);

  it('only one flush runs at a time', async () => {
    const { r, posts } = scriptedReporter([ok()]); for (let i = 0; i < 10; i++) r.record(ev(i));
    const [a, b] = await Promise.all([r.flush(), r.flush()]); expect(a).toEqual(b); expect(posts()).toHaveLength(1);
    expect(bodyOf(posts()[0]!).events.every((e) => e.session_id === SES)).toBe(true);
  });
});
