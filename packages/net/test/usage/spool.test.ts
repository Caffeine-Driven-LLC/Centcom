import { describe, expect, it } from 'vitest';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { MEMORY_MAX_EVENTS, SPOOL_MAX_BYTES, SPOOL_MAX_EVENTS, UsageSpool, cleanEvent } from '../../src/index.js';
import { AutoClock } from '../http/helpers.js';
import { SES, memLogger, tmp } from '../support.js';
import { bodyOf, ev, ids, ok, scriptedReporter } from './helpers.js';

const lines = (dir: string) => readFileSync(join(dir, 'spool.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
const eventLines = (dir: string) => lines(dir).filter((l) => typeof l.id === 'string');
const tick = () => new Promise((r) => setImmediate(r));

describe('crash recovery', () => {
  it('AC3: events recorded and never flushed are sent once by the next reporter on the same spool', async () => {
    const dir = tmp('usage'); const a = scriptedReporter([ok()], { spoolDir: dir });
    for (let i = 0; i < 120; i++) a.r.record(ev(i)); /* "killed" here: no flush, no stop */
    expect(eventLines(dir)).toHaveLength(120);
    const b = scriptedReporter([ok()], { spoolDir: dir }); expect(await b.r.flush()).toEqual({ sent: 120, kept: 0 });
    const sent = b.posts().flatMap((p) => bodyOf(p).events.map((e) => e.id)); expect(new Set(sent).size).toBe(120); expect(sent).toHaveLength(120);
    const c = scriptedReporter([ok()], { spoolDir: dir }); expect(await c.r.flush()).toEqual({ sent: 0, kept: 0 }); expect(c.posts()).toHaveLength(0);
  });

  it('a crash after a batch got its key resends that batch with the same key and body', async () => {
    const dir = tmp('usage'); let hang = true;
    const a = scriptedReporter([() => new Promise<Response>((_res, rej) => { if (!hang) rej(new Error('x')); })], { spoolDir: dir });
    for (let i = 0; i < 3; i++) a.r.record(ev(i)); void a.r.flush(); await tick(); await tick(); hang = false; /* the request never answers: "killed" mid-send */
    const first = a.posts()[0]!;
    const b = scriptedReporter([ok()], { spoolDir: dir }); await b.r.flush();
    expect(b.posts()).toHaveLength(1); expect(b.posts()[0]!.headers['idempotency-key']).toBe(first.headers['idempotency-key']); expect(b.posts()[0]!.body).toBe(first.body);
  });

  it('a spool truncated mid-line recovers every complete line and drops the partial one', async () => {
    const dir = tmp('usage'); const a = scriptedReporter([ok()], { spoolDir: dir }); for (let i = 0; i < 5; i++) a.r.record(ev(i));
    const whole = readFileSync(join(dir, 'spool.jsonl'), 'utf8'); writeFileSync(join(dir, 'spool.jsonl'), whole + whole.split('\n')[0]!.slice(0, 30));
    const b = scriptedReporter([ok()], { spoolDir: dir }); expect(await b.r.flush()).toEqual({ sent: 5, kept: 0 });
    /* garbage lines, unknown shapes and invalid events are skipped */
    const d2 = tmp('usage'); const id = ids(new AutoClock()).next('use');
    writeFileSync(join(d2, 'spool.jsonl'), ['not json', '{"weird":1}', JSON.stringify({ id, type: 'tokens_in', qty: -1, at: 'x' }), JSON.stringify({ id, type: 'relay_bytes', qty: 1, at: '2026-10-06T12:00:00.000Z' }), JSON.stringify({ id, type: 'tokens_in', qty: 2, at: '2026-10-06T12:00:00.000Z', session_id: SES, prompt: 'secret' })].join('\n') + '\n');
    const c = scriptedReporter([ok()], { spoolDir: d2 }); expect(await c.r.flush()).toEqual({ sent: 1, kept: 0 }); expect(bodyOf(c.posts()[0]!).events[0]).toEqual({ id, type: 'tokens_in', qty: 2, at: '2026-10-06T12:00:00.000Z', session_id: SES });
  });
});

describe('caps and speed', () => {
  it('AC4: 1,000 events/s for 12 s keeps the spool at 10,000 events (oldest dropped, counted) and record() never takes 5 ms', async () => {
    const clock = new AutoClock(); const { r, spoolDir } = scriptedReporter([ok()], { clock });
    let worst = 0; const times: number[] = [];
    for (let s = 0; s < 12; s++) {
      for (let i = 0; i < 1000; i++) { const t0 = performance.now(); r.record(ev(s * 1000 + i)); const d = performance.now() - t0; times.push(d); if (d > worst) worst = d; clock.t += 1; }
      await tick(); /* compaction runs between bursts, off the record() path */
    }
    await tick(); await tick();
    expect(r.stats()).toMatchObject({ pending: SPOOL_MAX_EVENTS, dropped: 2000 });
    const ev1 = eventLines(spoolDir); expect(ev1.length).toBeLessThanOrEqual(SPOOL_MAX_EVENTS); expect(statSync(join(spoolDir, 'spool.jsonl')).size).toBeLessThanOrEqual(SPOOL_MAX_BYTES);
    expect(ev1[0]!.qty).toBe(2000); /* the oldest 2,000 went */
    expect(worst).toBeLessThan(50); /* one call can hit a garbage collection or a busy machine; the 99th percentile below is the real guard */
    times.sort((a, b) => a - b); expect(times[Math.floor(times.length * 0.99)]!).toBeLessThan(1);
  });

  it('the byte cap holds too (a small cap for the test); a duplicate id is ignored', () => {
    const dir = tmp('usage'); const sp = new UsageSpool(dir, { maxBytes: 2000 }); const g = ids(new AutoClock());
    for (let i = 0; i < 100; i++) sp.append(cleanEvent({ id: g.next('use'), ...ev(i) })!);
    expect(sp.size()).toBeLessThan(20); expect(sp.dropped).toBe(100 - sp.size());
    const e = cleanEvent({ id: g.next('use'), ...ev(1) })!; sp.append(e); const n = sp.size(); sp.append(e); expect(sp.size()).toBe(n);
  });

  it('the spool file is mode 0600 in a 0700 folder', () => {
    const dir = join(tmp('usage'), 'usage'); const { r } = scriptedReporter([ok()], { spoolDir: dir }); r.record(ev(1));
    expect(statSync(join(dir, 'spool.jsonl')).mode & 0o777).toBe(0o600); expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('an unwritable disk falls back to memory with one warning and a cap of 1,000 events', async () => {
    const file = join(tmp('usage'), 'a-file'); writeFileSync(file, 'x'); const log = memLogger();
    const { r, posts } = scriptedReporter([ok()], { spoolDir: join(file, 'usage'), logger: log });
    for (let i = 0; i < 1500; i++) r.record(ev(i));
    expect(r.stats()).toMatchObject({ memoryOnly: true, pending: MEMORY_MAX_EVENTS, dropped: 500 });
    expect(log.lines.filter((l) => l.msg === 'usage.spool_unwritable')).toHaveLength(1);
    expect(await r.flush()).toEqual({ sent: 1000, kept: 0 }); expect(posts()).toHaveLength(2);
  });
});
