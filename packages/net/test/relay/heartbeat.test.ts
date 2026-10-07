import { afterEach, describe, expect, it } from 'vitest';
import { startMockBackend, type MockBackend } from '@centcom/testkit';
import { DEFAULT_DEAD_MS, DeadDetector, RelayClient, deadMsFrom, pongFor } from '../../src/index.js';
import { CLIENT, ManualClock, SID, rig } from './helpers.js';

describe('ping and pong (AC5)', () => {
  it('every sys.ping is answered at once by a sys.pong with the identical p.t', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept();
    for (const t of [1728151661123, 0, 'opaque']) s.receive({ v: 1, t: 'sys.ping', p: { t } });
    expect(s.of('sys.pong').map((f) => f.p)).toEqual([{ t: 1728151661123 }, { t: 0 }, { t: 'opaque' }]);
  });
  it('a pong goes out even while sends are paused by sys.slow_down', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept();
    s.receive({ v: 1, t: 'sys.slow_down', p: { for_ms: 5000, reason: 'rate' } }); s.receive({ v: 1, t: 'sys.ping', p: { t: 9 } });
    expect(s.of('sys.pong')).toHaveLength(1);
  });
  it('pongFor copies only p.t', () => {
    expect(pongFor({ v: 1, t: 'sys.ping', p: { t: 5, extra: 'x' } })).toEqual({ v: 1, t: 'sys.pong', p: { t: 5 } });
    expect(pongFor({ v: 1, t: 'sys.ping' })).toEqual({ v: 1, t: 'sys.pong', p: {} });
  });
});

describe('dead connection detector (AC5)', () => {
  it('with pings withheld the socket is closed 50 s after the last frame and a reconnect starts', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept();
    await r.clock.advance(DEFAULT_DEAD_MS - 1_000); expect(s.closeCalls).toHaveLength(0);
    await r.clock.advance(999); expect(s.closeCalls).toHaveLength(0);
    await r.clock.advance(1); expect(s.closeCalls).toHaveLength(1); expect(r.client.state).toBe('backoff');
    expect(r.ev.closed[0]!.willReconnect).toBe(true); expect(r.ev.link).toEqual(['online', 'reconnecting']);
    await r.clock.advance(250); const s2 = await r.nextSocket(); expect(s2).not.toBe(s); expect(r.tickets).toHaveLength(2);
  });
  it('any inbound frame resets the timer, even one that is dropped as invalid', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept();
    await r.clock.advance(30_000); s.receive({ v: 1, t: 'sys.notice', p: { code: 'x', level: 'info', params: {} } });
    await r.clock.advance(30_000); s.receive('not json');
    await r.clock.advance(49_000); expect(s.closeCalls).toHaveLength(0);
    await r.clock.advance(1_000); expect(s.closeCalls).toHaveLength(1);
  });
  it('dead_ms comes from the welcome when it is sane', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept({ heartbeat: { ping_ms: 5000, dead_ms: 12_000 } });
    await r.clock.advance(11_999); expect(s.closeCalls).toHaveLength(0); await r.clock.advance(1); expect(s.closeCalls).toHaveLength(1);
    expect(deadMsFrom({ dead_ms: 1 })).toBe(DEFAULT_DEAD_MS); expect(deadMsFrom({ dead_ms: 10 ** 9 })).toBe(DEFAULT_DEAD_MS); expect(deadMsFrom(undefined)).toBe(DEFAULT_DEAD_MS); expect(deadMsFrom({ dead_ms: 30_000 })).toBe(30_000);
  });
  it('DeadDetector fires once, re-arms for the remainder after activity, and stop() cancels it', async () => {
    const clock = new ManualClock(); let dead = 0; const d = new DeadDetector(clock, 1000, () => dead++);
    d.start(); await clock.advance(600); d.touch(); await clock.advance(600); expect(dead).toBe(0); await clock.advance(400); expect(dead).toBe(1);
    await clock.advance(5000); expect(dead).toBe(1);
    d.start(); d.stop(); await clock.advance(5000); expect(dead).toBe(1); expect(clock.timers.size).toBe(0);
  });
});

describe('against the mock relay (pings every 20 s)', () => {
  let m: MockBackend | undefined; let client: RelayClient | undefined;
  afterEach(async () => { await client?.close().catch(() => undefined); await m?.stop(); m = undefined; client = undefined; });
  it('answers every ping so the relay never drops it, across several minutes of virtual time', async () => {
    m = await startMockBackend({ clock: 'virtual', seed: 3 }); const mock = m; const pings: number[] = [];
    client = new RelayClient({ url: mock.wsUrl, allowPlainWs: true, sessionId: SID, clock: mock.clock, getTicket: async () => ({ ticket: ((await mock.control('ticket', { sid: SID, name: 'Ada' })) as { ticket: string }).ticket }), getLastSeq: () => null, clientInfo: CLIENT });
    client.on('frame', (f) => { if (f.t === 'sys.ping') pings.push(f.p!.t as number); });
    let closed = 0; client.on('closed', () => closed++);
    await client.connect();
    for (let i = 0; i < 9; i++) { await mock.advance(20_000); const want = i + 1; const end = Date.now() + 2000; while (pings.length < want && Date.now() < end) await new Promise((r) => setTimeout(r, 5)); }
    expect(pings).toHaveLength(9); expect(closed).toBe(0); expect(client.state).toBe('ready');
  });
});
