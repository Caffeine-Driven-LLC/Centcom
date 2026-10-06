import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MockBackend } from '@centcom/testkit';
import { AutoClock, json, problem } from '../http/helpers.js';
import { SES, memLogger, mockWith, tmp } from '../support.js';
import { bodyOf, build, ev, ids, ok, scriptedReporter } from './helpers.js';

let m: MockBackend | undefined; afterEach(async () => { await m?.stop(); m = undefined; });
const fail5 = (code = 'service_unavailable', status = 503) => Array.from({ length: 5 }, () => problem(status, code));

describe('outcomes of POST /v1/usage/events', () => {
  it('2xx removes the batch from the spool', async () => {
    const { r, spoolDir } = scriptedReporter([ok()]); for (let i = 0; i < 3; i++) r.record(ev(i));
    expect(await r.flush()).toEqual({ sent: 3, kept: 0 }); await new Promise((x) => setImmediate(x));
    expect(readFileSync(join(spoolDir, 'spool.jsonl'), 'utf8').split('\n').filter((l) => l.includes('"type"'))).toHaveLength(0);
  });

  it('AC2: a 502 on the first POST then 200: the second POST has the same key and body, the mock counts the events once (Idempotency-Replayed)', async () => {
    let first = true; const t = await mockWith([], {
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const res = await globalThis.fetch(input, init);
        if (first && init?.method === 'POST') { first = false; await res.arrayBuffer(); return problem(502, 'bad_gateway'); } /* ingested, then the answer was lost */
        return res;
      }) as typeof fetch,
    }); m = t.m; const log = memLogger();
    const { r } = build(t.http, new AutoClock(), { logger: log }); for (let i = 0; i < 4; i++) r.record(ev(i));
    expect(await r.flush()).toEqual({ sent: 4, kept: 0 });
    const posts = t.seen.filter((s) => s.method === 'POST'); expect(posts).toHaveLength(2);
    expect(posts[1]!.headers['idempotency-key']).toBe(posts[0]!.headers['idempotency-key']); expect(posts[1]!.body).toBe(posts[0]!.body);
    expect(t.m.state.idem.size).toBe(1); expect(log.lines.find((l) => l.msg === 'usage.batch_sent')!.ctx.replayed).toBe(true);
  });

  it('409 idempotency_conflict with an unchanged body drops the batch (poison), no retry', async () => {
    const { r, posts } = scriptedReporter([problem(409, 'idempotency_conflict'), ok()]); for (let i = 0; i < 2; i++) r.record(ev(i));
    expect(await r.flush()).toEqual({ sent: 0, kept: 0 }); expect(posts()).toHaveLength(1); expect(r.poisoned).toBe(1);
  });

  it('409 idempotency_conflict when the body changed (an event was lost in a crash): one retry with a new key, then done', async () => {
    const dir = tmp('usage'); mkdirSync(dir, { recursive: true }); const g = ids(new AutoClock());
    const evs = [0, 1].map((i) => ({ id: g.next('use'), ...ev(i) })); const lost = g.next('use');
    writeFileSync(join(dir, 'spool.jsonl'), [...evs.map((e) => JSON.stringify(e)), JSON.stringify({ batch: 'OLDKEY', ids: [evs[0]!.id, evs[1]!.id, lost], sha: 'f'.repeat(64) })].join('\n') + '\n');
    const { r, posts } = scriptedReporter([problem(409, 'idempotency_conflict'), ok(2)], { spoolDir: dir });
    expect(await r.flush()).toEqual({ sent: 2, kept: 0 });
    const p = posts(); expect(p).toHaveLength(2); expect(p[0]!.headers['idempotency-key']).toBe('OLDKEY'); expect(p[1]!.headers['idempotency-key']).not.toBe('OLDKEY'); expect(p[1]!.body).toBe(p[0]!.body);
    expect(bodyOf(p[0]!).events.map((e) => e.id)).toEqual(evs.map((e) => e.id));
    /* a second conflict after the new key: dropped, not retried again */
    const d2 = tmp('usage'); writeFileSync(join(d2, 'spool.jsonl'), [JSON.stringify(evs[0]), JSON.stringify({ batch: 'K2', ids: [evs[0]!.id, lost], sha: '0'.repeat(64) })].join('\n') + '\n');
    const two = scriptedReporter([problem(409, 'idempotency_conflict'), problem(409, 'idempotency_conflict'), ok()], { spoolDir: d2 });
    expect(await two.r.flush()).toEqual({ sent: 0, kept: 0 }); expect(two.posts()).toHaveLength(2); expect(two.r.poisoned).toBe(1);
  });

  it('AC8: a 422 with errors[].pointer drops that batch, logs only the code and pointer, and later batches still go', async () => {
    const log = memLogger();
    const { r, posts } = scriptedReporter([problem(422, 'validation_failed', { errors: [{ pointer: '/events/3/qty', code: 'minimum', detail: 'qty must be >= 0 (was "secret text")' }] }), ok(100)], { maxBatch: 100, logger: log });
    for (let i = 0; i < 200; i++) r.record(ev(i));
    expect(await r.flush()).toEqual({ sent: 100, kept: 0 }); expect(posts()).toHaveLength(2); expect(r.poisoned).toBe(1);
    const line = log.lines.find((l) => l.msg === 'usage.batch_dropped')!; expect(line.ctx).toMatchObject({ code: 'validation_failed', pointers: ['/events/3/qty'] });
    expect(Object.keys(line.ctx).sort()).toEqual(['code', 'component', 'events', 'pointers', 'request_id']); expect(JSON.stringify(log.lines)).not.toMatch(/secret|use_|ses_/);
  });

  it('other 4xx (400, 403, 413) are dropped too; the reporter stays alive', async () => {
    const { r, posts } = scriptedReporter([problem(400, 'invalid_request'), problem(403, 'forbidden'), problem(413, 'payload_too_large'), ok(1)], { maxBatch: 1 });
    for (let i = 0; i < 4; i++) r.record(ev(i)); expect(await r.flush()).toEqual({ sent: 1, kept: 0 }); expect(posts()).toHaveLength(4); expect(r.stats().poisoned).toBe(3);
  });

  it('AC6: a 429 retry_after_s 90 pauses all sending for 90 s while record() goes on', async () => {
    const clock = new AutoClock();
    const { r, posts } = scriptedReporter([problem(429, 'rate_limited', { retry_after_s: 90 }, { 'retry-after': '90' }), ok()], { clock });
    for (let i = 0; i < 3; i++) r.record(ev(i));
    expect(await r.flush()).toEqual({ sent: 0, kept: 3 }); expect(posts()).toHaveLength(1); expect(r.stats().pausedUntil).toBe(new Date(clock.now() + 90_000).toISOString());
    clock.t += 89_000; for (let i = 3; i < 6; i++) r.record(ev(i)); expect(await r.flush()).toEqual({ sent: 0, kept: 6 }); expect(posts()).toHaveLength(1);
    clock.t += 1_000; expect(await r.flush()).toEqual({ sent: 6, kept: 0 }); expect(posts()).toHaveLength(3);
    expect(r.quota().level).toBe('ok'); /* rate_limited is not a quota */
  });

  it('a 429 quota_exceeded sets the quota to reached and pauses, but reporting resumes after retry_after_s', async () => {
    const clock = new AutoClock(); const { r, posts } = scriptedReporter([problem(429, 'quota_exceeded', { retry_after_s: 3600 }), ok()], { clock });
    r.record(ev(1)); await r.flush(); expect(r.quota()).toMatchObject({ level: 'reached', resetsAt: new Date(clock.now() + 3_600_000).toISOString() }); expect(r.allowsHostedActions()).toBe(false);
    clock.t += 3_600_000; expect(await r.flush()).toEqual({ sent: 1, kept: 0 }); expect(posts()).toHaveLength(2);
  });

  it('5xx after the client retries, offline and 401 keep the batch (backing off on failures)', async () => {
    const a = scriptedReporter([...fail5(), ok()]); a.r.record(ev(1)); expect(await a.r.flush()).toEqual({ sent: 0, kept: 1 }); expect(a.r.stats().pausedUntil).not.toBeNull();
    expect(await a.r.flush()).toEqual({ sent: 0, kept: 1 }); expect(a.posts()).toHaveLength(5); /* still backing off */
    a.clock.t += 6 * 60_000; expect(await a.r.flush()).toEqual({ sent: 1, kept: 0 });
    const b = scriptedReporter([new TypeError('fetch failed')]); b.r.record(ev(1)); expect(await b.r.flush()).toEqual({ sent: 0, kept: 1 }); expect(b.posts()).toHaveLength(5);
    const c = scriptedReporter([problem(401, 'token_invalid')]); c.r.record(ev(1)); expect(await c.r.flush()).toEqual({ sent: 0, kept: 1 }); expect(c.r.poisoned).toBe(0);
    const d = scriptedReporter([new Response('<html>proxy</html>', { status: 502 })]); d.r.record(ev(1)); expect(await d.r.flush()).toEqual({ sent: 0, kept: 1 });
  });

  it('a 2xx whose body is off-contract still counts as taken (no resend loop)', async () => {
    const { r, posts } = scriptedReporter([json(200, { accepted: 'many' }), ok()]); r.record(ev(1)); r.record(ev(2));
    expect(await r.flush()).toEqual({ sent: 2, kept: 0 }); expect(posts()).toHaveLength(1);
    expect(bodyOf(posts()[0]!).events.every((e) => e.session_id === SES)).toBe(true);
  });
});
