import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CentcomError, FlagsClient, FLAGS_CACHE_VERSION, clampTtlS, defineFlag, type FlagDefs, type HttpClient } from '../../src/index.js';
import { memLogger, tmp } from '../support.js';

const flush = async (n = 4): Promise<void> => { for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r)); };
/** Time moves only in advance(); due timers fire in order. */
class ManualClock { t = Date.UTC(2026, 9, 6, 12); private id = 0; private timers = new Map<number, { at: number; fn: () => void }>(); now() { return this.t; } setTimeout(fn: () => void, ms: number) { const id = ++this.id; this.timers.set(id, { at: this.t + Math.max(0, ms), fn }); return id; } clearTimeout(h: never) { this.timers.delete(h as unknown as number); }
  async advance(ms: number) { const target = this.t + ms; await flush(2); for (;;) { let next: [number, { at: number; fn: () => void }] | undefined; for (const e of this.timers) if (e[1].at <= target && (!next || e[1].at < next[1].at)) next = e; if (!next) break; this.timers.delete(next[0]); this.t = Math.max(this.t, next[1].at); next[1].fn(); await flush(2); } this.t = target; await flush(2); }
  pendingDelays() { return [...this.timers.values()].map((x) => x.at - this.t); } }
interface R { beta_ui: boolean; limit: number; theme: string }
const DEFS: FlagDefs<R> = { beta_ui: defineFlag('beta_ui', { type: 'boolean', default: false }), limit: defineFlag('limit', { type: 'number', default: 5 }), theme: defineFlag('theme', { type: 'string', default: 'plain' }) } as FlagDefs<R>;
type Reply = { flags: Record<string, unknown>; rev: number; ttl_s: number; etag?: string } | 'fail' | 'not-modified' | 'slow';
function rig(o: { dir?: string; env?: Record<string, string>; dev?: boolean; replies?: Reply[]; config?: unknown } = {}) {
  const clock = new ManualClock(); const calls: { kind: string; etag?: string }[] = []; const replies = o.replies ?? []; const log = memLogger(); const ev: Record<string, (() => void)[]> = {};
  const http = {
    call: async (_op: string) => { calls.push({ kind: 'call' }); const r = replies.shift(); if (r === 'fail' || !r) throw new CentcomError({ kind: 'network', detail: 'down' }); return { data: r, etag: (r as { etag?: string }).etag, status: 200 }; },
    revalidate: async (_op: string, _a: unknown, etag: string) => { calls.push({ kind: 'revalidate', etag }); const r = replies.shift(); if (r === 'not-modified') return { notModified: true }; if (r === 'fail' || !r) throw new CentcomError({ kind: 'network', detail: 'down' }); return { notModified: false, data: r, etag: (r as { etag?: string }).etag }; },
  } as unknown as HttpClient;
  const dir = o.dir ?? tmp('flags'); const c = new FlagsClient<R>({ http, cacheDir: dir, clock, config: { get: () => o.config }, env: o.env ?? {}, isDevBuild: o.dev ?? false, logger: log, registry: DEFS, auth: { on: (e, f) => { (ev[e] ??= []).push(f); return () => undefined; } } });
  return { c, clock, calls, dir, log, fire: (e: string) => ev[e]!.forEach((f) => f()) };
}
const ok = (flags: Record<string, unknown>, o: { rev?: number; ttl_s?: number; etag?: string } = {}): Reply => ({ flags, rev: o.rev ?? 1, ttl_s: o.ttl_s ?? 300, etag: o.etag ?? '"e1"' });

describe('start and defaults', () => {
  it('flag() answers the default at once with the network down; start() returns before any I/O finishes', async () => {
    const r = rig({ replies: ['fail'] }); const t0 = performance.now(); expect(r.c.flag('beta_ui')).toBe(false); expect(r.c.flag('limit')).toBe(5); expect(performance.now() - t0).toBeLessThan(1 + 5); r.c.start(); expect(r.calls.length).toBeLessThanOrEqual(1); expect(r.c.snapshot().source).toBe('defaults'); await flush(); expect(r.c.flag('theme')).toBe('plain'); r.c.stop();
  });
  it('the first refresh fills the cache and says what was added, once', async () => {
    const r = rig({ replies: [ok({ beta_ui: true, extra: 1 })] }); const seen: unknown[] = []; r.c.on('flags-changed', (d) => seen.push(d)); r.c.start(); await flush(); expect(r.c.flag('beta_ui')).toBe(true); expect(r.c.snapshot()).toMatchObject({ source: 'network', rev: 1 }); expect(seen).toEqual([{ added: ['beta_ui', 'extra'], removed: [], changed: [] }]); expect(existsSync(join(r.dir, 'flags.json'))).toBe(true); r.c.stop();
  });
  it('an asking for a key that is not in the registry is a mistake; unknown server keys are kept but not returned by flag()', async () => { const r = rig({ replies: [ok({ nope: true })] }); r.c.start(); await flush(); expect(() => r.c.flag('nope' as never)).toThrow(TypeError); expect(r.c.snapshot().flags).toEqual({ nope: true }); r.c.stop(); });
});

describe('revalidation and timing', () => {
  it('the second refresh sends the stored ETag; a 304 changes nothing and says nothing', async () => {
    const r = rig({ replies: [ok({ beta_ui: true }, { etag: '"abc"', ttl_s: 60 }), 'not-modified'] }); const seen: unknown[] = []; r.c.on('flags-changed', (d) => seen.push(d)); r.c.start(); await flush(); await r.clock.advance(60_000); await flush();
    expect(r.calls.map((x) => x.kind)).toEqual(['call', 'revalidate']); expect(r.calls[1]!.etag).toBe('"abc"'); expect(seen).toHaveLength(1); expect(r.c.flag('beta_ui')).toBe(true); r.c.stop();
  });
  it('ttl is clamped to 30 s to 3,600 s, and the refresh timer follows it', async () => {
    expect([clampTtlS(5), clampTtlS(86_400), clampTtlS(300), clampTtlS(NaN)]).toEqual([30, 3600, 300, 30]);
    const r = rig({ replies: [ok({}, { ttl_s: 5 }), ok({}, { ttl_s: 5, rev: 2 })] }); r.c.start(); await flush(); await r.clock.advance(29_000); expect(r.calls).toHaveLength(1); await r.clock.advance(1100); await flush(); expect(r.calls).toHaveLength(2); r.c.stop();
    const big = rig({ replies: [ok({}, { ttl_s: 86_400 })] }); big.c.start(); await flush(); expect(big.clock.pendingDelays()).toContain(3_600_000); big.c.stop();
  });
  it('after a failure the next try is a minute away', async () => { const r = rig({ replies: ['fail'] }); r.c.start(); await flush(); expect(r.clock.pendingDelays()).toContain(60_000); r.c.stop(); });
  it('concurrent refreshes make one request; login and logout each trigger a refresh', async () => {
    const r = rig({ replies: [ok({ beta_ui: true }), ok({ beta_ui: false }, { rev: 2, etag: '"e2"' }), ok({}, { rev: 3, etag: '"e3"' })] }); const p = [r.c.refresh(), r.c.refresh(), r.c.refresh()]; await Promise.all(p); expect(r.calls).toHaveLength(1);
    r.c.start(); await flush(); const n = r.calls.length; r.fire('login'); await flush(); expect(r.calls.length).toBeGreaterThan(n); const m = r.calls.length; r.fire('logout'); await flush(); expect(r.calls.length).toBeGreaterThan(m); r.c.stop();
  });
  it('a malformed answer keeps the old values', async () => { const r = rig({ replies: [ok({ beta_ui: true }), { flags: 'garbage', rev: 'x', ttl_s: 'y' } as unknown as Reply] }); r.c.start(); await flush(); await r.clock.advance(300_000); await flush(); expect(r.c.flag('beta_ui')).toBe(true); r.c.stop(); });
});

describe('types and the disk cache', () => {
  it('a value of the wrong type is ignored (the default stays) and noted at debug', async () => { const r = rig({ replies: [ok({ beta_ui: 'yes', limit: 9 })] }); r.c.start(); await flush(); expect(r.c.flag('beta_ui')).toBe(false); expect(r.c.flag('limit')).toBe(9); expect(r.log.lines.some((l) => l.msg === 'flags.wrong_type')).toBe(true); r.c.stop(); });
  it('after a restart with the network down the disk cache is used for up to 7 days, then the defaults', async () => {
    const a = rig({ replies: [ok({ beta_ui: true })] }); a.c.start(); await flush(); a.c.stop();
    const b = rig({ dir: a.dir, replies: ['fail'] }); expect(b.c.snapshot().source).toBe('cache'); expect(b.c.flag('beta_ui')).toBe(true);
    const old = rig({ dir: a.dir }); const file = join(a.dir, 'flags.json'); const j = JSON.parse(readFileSync(file, 'utf8')); j.fetched_at = new Date(old.clock.now() - 8 * 86_400_000).toISOString(); writeFileSync(file, JSON.stringify(j)); const stale = rig({ dir: a.dir }); expect(stale.c.snapshot().source).toBe('defaults'); expect(stale.c.flag('beta_ui')).toBe(false);
    writeFileSync(file, '{not json'); expect(rig({ dir: a.dir }).c.snapshot().source).toBe('defaults'); expect(FLAGS_CACHE_VERSION).toBeGreaterThan(0);
  });
});

describe('developer overrides', () => {
  it('CENTCOM_FLAGS overrides only in a dev build or with CENTCOM_DEV=1; a stable build ignores it and warns once', () => {
    const dev = rig({ env: { CENTCOM_FLAGS: 'beta_ui=true,limit=9,theme=dark,unknown=1' }, dev: true }); expect([dev.c.flag('beta_ui'), dev.c.flag('limit'), dev.c.flag('theme')]).toEqual([true, 9, 'dark']);
    const envDev = rig({ env: { CENTCOM_FLAGS: 'beta_ui=true', CENTCOM_DEV: '1' } }); expect(envDev.c.flag('beta_ui')).toBe(true);
    const stable = rig({ env: { CENTCOM_FLAGS: 'beta_ui=true' } }); expect(stable.c.flag('beta_ui')).toBe(false); stable.c.loadOverrides(); expect(stable.log.lines.filter((l) => l.msg === 'flags.overrides_ignored')).toHaveLength(1);
    const wrong = rig({ env: { CENTCOM_FLAGS: 'beta_ui=maybe,limit=lots' }, dev: true }); expect([wrong.c.flag('beta_ui'), wrong.c.flag('limit')]).toEqual([false, 5]);
  });
  it('the config key works too, and the environment wins over it', () => { const r = rig({ config: { beta_ui: true, limit: 2 }, env: { CENTCOM_FLAGS: 'limit=7' }, dev: true }); expect([r.c.flag('beta_ui'), r.c.flag('limit')]).toEqual([true, 7]); });
});
