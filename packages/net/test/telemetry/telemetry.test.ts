import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { ERROR_TABLE, validateAgainst } from '@centcom/protocol';
import { sanitize, telemetryEnabled } from '../../src/index.js';
import { emitAll, rig, stateFs, tick } from './helpers.js';

afterEach(() => { vi.restoreAllMocks(); });
const run = async (r: ReturnType<typeof rig>, ms = 0) => { await tick(); await r.clock.advance(ms); await tick(); await tick(); };

describe('the gate', () => {
  it('off by default: 10,000 emit calls cause no request, no file access, no timer, nothing buffered', async () => {
    const r = rig({ enabled: false }); for (let i = 0; i < 1000; i++) emitAll(r.t); await run(r, 120_000);
    expect(r.reqs).toEqual([]); expect(r.fs.log).toEqual({ reads: 0, writes: 0, removes: 0 }); expect(r.clock.pending()).toBe(0); expect(r.t.status()).toMatchObject({ enabled: false, buffered: 0, dropped: 0, installIdPresent: false }); await r.t.flush(); expect(r.reqs).toEqual([]);
  });
  it.each([[true, undefined, undefined, true], [true, '1', undefined, false], [true, 'true', undefined, false], [true, '0', undefined, true], [true, undefined, 'off', false], [true, undefined, 'OFF', false], [true, undefined, 'on', true], [true, '1', 'off', false], [false, undefined, undefined, false], [false, '0', 'on', false]])('config %s, DO_NOT_TRACK %s, CENTCOM_TELEMETRY %s -> %s', async (cfg, dnt, tel, expected) => {
    const r = rig({ enabled: cfg, env: { DO_NOT_TRACK: dnt, CENTCOM_TELEMETRY: tel } }); r.t.appStart(); await run(r); expect(telemetryEnabled({ enabled: cfg }, { DO_NOT_TRACK: dnt, CENTCOM_TELEMETRY: tel })).toBe(expected); expect(r.reqs.length > 0).toBe(expected); expect(r.t.status().enabled).toBe(expected);
  });
  it('turning it off while running drops what was buffered and stops the timers', async () => { const r = rig(); r.t.appStart(); r.t.featureUsed('a'); expect(r.t.status().buffered).toBe(2); r.state.enabled = false; r.t.appExit(); expect(r.t.status().buffered).toBe(0); expect(r.clock.pending()).toBe(0); await run(r, 120_000); expect(r.reqs).toEqual([]); });
  it('flush and dispose are no-ops when off, and flush clears anything left', async () => { const r = rig(); r.t.appStart(); r.state.enabled = false; await r.t.flush(); expect(r.reqs).toEqual([]); expect(r.t.status().buffered).toBe(0); r.t.dispose(); });
});

describe('allow-list', () => {
  const ok = (type: Parameters<typeof sanitize>[0], a: Record<string, unknown>, o?: Parameters<typeof sanitize>[2]) => expect(sanitize(type, a, o), JSON.stringify(a)).not.toBeUndefined();
  const no = (type: Parameters<typeof sanitize>[0], a: Record<string, unknown>, o?: Parameters<typeof sanitize>[2]) => expect(sanitize(type, a, o), JSON.stringify(a)).toBeUndefined();
  it('command.run: a registered, lowercase name; nothing with spaces, paths or capitals', () => { ok('command.run', { name: 'login' }); ok('command.run', { name: 'a-b2' }); for (const n of ['foo bar', 'Login', '/home/a', '', 'a'.repeat(33), '1abc', 'a_b', 'a.b', 5, null]) no('command.run', { name: n }); no('command.run', { name: 'unknown' }, { commands: new Set(['login']) }); ok('command.run', { name: 'login' }, { commands: new Set(['login']) }); });
  it('feature.used: a short key; no paths, no spaces', () => { ok('feature.used', { key: 'web.open' }); ok('feature.used', { key: 'a_b-c.d' }); for (const k of ['/home/alex/x', 'has space', 'Upper', 'a'.repeat(49), '', '../x', 'a@b.c', 'alexs-macbook.local', 'build.acme.com', 'notes.txt', 'secrets.env']) no('feature.used', { key: k }); no('feature.used', { key: 'web.open' }, { features: new Set(['other']) }); ok('feature.used', { key: 'web.open' }, { features: new Set(['web.open']) }); });
  it('agent.state_change: only agent-level states', () => { ok('agent.state_change', { from: 'idle', to: 'thinking' }); for (const [f, t] of [['idle', 'offline'], ['x', 'y'], ['provider-auth-required', 'idle'], ['idle', 5]]) no('agent.state_change', { from: f, to: t }); });
  it('error.shown: only codes of the registry', () => { for (const c of Object.keys(ERROR_TABLE).slice(0, 5)) ok('error.shown', { code: c }); for (const c of ['not_a_code', '__proto__', 'constructor', 'toString', '', 5]) no('error.shown', { code: c }); });
  it('session events: mode and transport enums', () => { ok('session.created', { mode: 'command_post', transport: 'lan' }); ok('session.joined', { transport: 'relay' }); no('session.created', { mode: 'solo', transport: 'lan' }); no('session.created', { mode: 'branch', transport: 'wifi' }); no('session.joined', { transport: 'x' }); });
  it('numbers are bounded and rounded; versions are plain semver', () => { expect(sanitize('perf.startup', { ms: 120.6 })).toEqual({ ms: 121 }); expect(sanitize('perf.frame', { p95_ms: 8.46 })).toEqual({ p95_ms: 8.5 }); for (const v of [-1, NaN, Infinity, 1e9, '5', null]) { no('perf.startup', { ms: v }); no('perf.frame', { p95_ms: v }); } ok('update.result', { from: '1.0.0', to: '1.2.3-beta.1', ok: false }); for (const v of ['v1.0.0', '1.0', 'latest', '1.0.0+build', '/x', '1.0.0-' + 'a'.repeat(30)]) no('update.result', { from: v, to: '1.0.0', ok: true }); no('update.result', { from: '1.0.0', to: '1.0.1', ok: 'yes' });
  });
  it('a refused event is counted, never buffered, never sent', async () => { const r = rig(); r.t.commandRun('foo bar'); r.t.featureUsed('/home/alex/x'); r.t.errorShown('not_a_code' as never); r.t.perfStartup(-5); expect(r.t.status()).toMatchObject({ dropped: 4, buffered: 0 }); await run(r, 120_000); expect(r.reqs).toEqual([]); r.t.appStart(); expect(r.t.status()).toMatchObject({ dropped: 4, buffered: 1 }); });
  it('app.start and app.exit carry no properties', () => { expect(sanitize('app.start', { anything: '/home/x' })).toBeNull(); expect(sanitize('app.exit', {})).toBeNull(); });
});

describe('batching', () => {
  it('250 events within a second go out as 100, 100, 50: the first at once, the others one minute apart', async () => {
    const r = rig(); for (let i = 0; i < 250; i++) r.t.featureUsed('k' + (i % 7)); await run(r, 0); expect(r.reqs.map((q) => q.json.events.length)).toEqual([100]); await run(r, 59_999); expect(r.reqs).toHaveLength(1); await run(r, 1); expect(r.reqs.map((q) => q.json.events.length)).toEqual([100, 100]); await run(r, 59_999); expect(r.reqs).toHaveLength(2); await run(r, 1); expect(r.reqs.map((q) => q.json.events.length)).toEqual([100, 100, 50]);
    expect(r.reqs.map((q) => q.at)).toEqual([r.reqs[0]!.at, r.reqs[0]!.at + 60_000, r.reqs[0]!.at + 120_000]); for (const q of r.reqs) expect(Buffer.byteLength(q.body)).toBeLessThan(64 * 1024); await run(r, 600_000); expect(r.reqs).toHaveLength(3); expect(r.clock.pending()).toBe(0); expect(r.t.status()).toMatchObject({ buffered: 0, sentBatches: 3 });
  });
  it('a single event waits for nothing; the next one a few seconds later waits for the minute', async () => { const r = rig(); r.t.appStart(); await run(r); expect(r.reqs).toHaveLength(1); await run(r, 5000); r.t.appExit(); await run(r, 54_999); expect(r.reqs).toHaveLength(1); await run(r, 1); expect(r.reqs).toHaveLength(2); });
  it('the order of events is kept, and a batch never exceeds 100 events or 64 KiB', async () => { const r = rig(); for (let i = 0; i < 150; i++) r.t.perfStartup(i); await run(r, 120_000); const ms = r.reqs.flatMap((q) => q.json.events.map((e) => e.props!.ms)); expect(ms).toEqual(Array.from({ length: 150 }, (_x, i) => i)); expect(Math.max(...r.reqs.map((q) => q.json.events.length))).toBe(100); });
  it('the gap uses the monotonic clock: a wall clock that jumps back does not make it send faster', async () => {
    let m = 0; const r = rig({ mono: () => m }); r.t.appStart(); await run(r); expect(r.reqs).toHaveLength(1); r.t.appExit(); m = 30_000; await run(r, 30_000); expect(r.reqs).toHaveLength(1); m = 60_000; await run(r, 30_000); expect(r.reqs).toHaveLength(2);
  });
  it('flush sends what is allowed to go now (one batch, only if a minute passed) and never waits past the deadline', async () => {
    const r = rig(); r.t.appStart(); await r.t.flush(); expect(r.reqs).toHaveLength(1); r.t.appExit(); await r.t.flush(); expect(r.reqs).toHaveLength(1); expect(r.t.status().buffered).toBe(1); await r.clock.advance(60_000); await tick(); expect(r.reqs).toHaveLength(2);
  });
});

describe('buffer cap', () => {
  it('1,200 events with the network down leave exactly 1,000: the oldest 200 are gone', async () => {
    const r = rig({ status: 'throw' }); r.t.appStart(); await run(r); const base = r.reqs.length; r.t.dispose(); for (let i = 0; i < 1200; i++) r.t.perfStartup(i); expect(r.t.status()).toMatchObject({ buffered: 1000, overflowed: 200 }); r.state.status = 204; r.t.perfStartup(5000); await run(r, 10 * 60_000);
    const seen = r.reqs.slice(base).flatMap((q) => q.json.events.map((e) => e.props!.ms as number)); expect(seen.slice(0, 3)).toEqual([201, 202, 203]); expect(Math.min(...seen.filter((x) => x < 5000))).toBe(201);
  });
  it('overflow never throws and keeps working', () => { const r = rig({ status: 'hang' }); for (let i = 0; i < 5000; i++) r.t.perfFrame(i % 100); expect(r.t.status().buffered).toBeLessThanOrEqual(1000); });
});
