import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { CLOSE_CODES, startMockBackend, type MockBackend } from '@centcom/testkit';
import { CLOSE_POLICY, CentcomError, ReconnectPlanner, RelayClient, RelayError, closePolicy, relayBackoffDelayMs as backoffDelayMs, type ReconnectMode } from '../../src/index.js';
import { CLIENT, SID, flush, rig } from './helpers.js';

/** CT-WS-ENVELOPE close table and "Reconnection" rules, as the client must apply them. */
const EXPECTED: Record<number, ReconnectMode> = { 1000: 'backoff', 1001: 'immediate', 4400: 'backoff', 4401: 'refresh_once', 4403: 'no', 4404: 'no', 4408: 'backoff', 4409: 'no', 4426: 'no', 4429: 'backoff', 4503: 'after_retry_after' };
const delays = (r: ReturnType<typeof rig>) => r.ring.snapshot().filter((x) => x.msg === 'relay.reconnect').map((x) => x.delay_ms as number);
/** Move the clock exactly to the pending reconnect. */
const toNextAttempt = (r: ReturnType<typeof rig>) => r.clock.advance(delays(r).at(-1)!);

describe('close policy table', () => {
  it('covers every close code of the contract (the mock knows the same list)', () => {
    expect(Object.keys(CLOSE_POLICY).map(Number).sort()).toEqual([...CLOSE_CODES].sort());
    for (const code of CLOSE_CODES) expect(CLOSE_POLICY[code]!.reconnect, String(code)).toBe(EXPECTED[code]);
    expect(closePolicy(1006).reconnect).toBe('backoff'); expect(closePolicy(4999).reconnect).toBe('backoff');
  });
  for (const code of Object.keys(EXPECTED).map(Number)) {
    const mode = EXPECTED[code]!;
    it(`server close ${code}: ${mode}`, async () => {
      const r = rig({ onAuthFailure: async () => true }); void r.client.connect(); const s = await r.accept();
      if (code === 4503) s.receive({ v: 1, t: 'sys.error', p: { type: 'x', title: 'x', status: 503, code: 'service_unavailable', request_id: 'req_01JA3Z8K2M5N7P9Q0R1S2T3V4W', retry_after_s: 2 } });
      s.serverClose(code); await flush();
      expect(r.ev.closed).toHaveLength(1); expect(r.ev.closed[0]!.willReconnect).toBe(mode !== 'no');
      expect(r.client.state).toBe(mode === 'no' ? 'closed' : 'backoff');
      if (CLOSE_POLICY[code]!.userFacing) expect(r.ev.closed[0]!.userFacing).toBe(CLOSE_POLICY[code]!.userFacing);
      await r.clock.advance(60_000); if (mode === 'no') expect(r.srv.sockets).toHaveLength(1); else expect(r.srv.sockets.length).toBeGreaterThan(1);
    });
  }
});

describe('backoff (AC6, AC12)', () => {
  it('backoffDelayMs = floor(rng * min(15000, 250 * 2^n))', () => {
    expect([0, 1, 2, 3, 6, 7, 20].map((n) => backoffDelayMs(n, () => 0.999999))).toEqual([249, 499, 999, 1999, 15_999 > 15_000 ? 14_999 : 0, 14_999, 14_999]);
    expect(backoffDelayMs(5, () => 0)).toBe(0);
  });
  it('property: never above 15 s, never negative, within the bound for its attempt', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 1000 }), fc.double({ min: 0, max: 0.9999999, noNaN: true }), (n, x) => {
      const d = backoffDelayMs(n, () => x); return d >= 0 && d < 15_000 && d < Math.min(15_000, 250 * 2 ** Math.min(n, 30)) + 1;
    }), { seed: 54, numRuns: 2000 });
  });
  it('repeated 1006 closes back off within [0,250], [0,500], [0,1000] ... capped at 15000, one fresh ticket per attempt', async () => {
    const r = rig(); void r.client.connect();
    for (let i = 0; i < 10; i++) { const s = await r.nextSocket(); s.error('ECONNREFUSED'); s.serverClose(1006); await flush(); await toNextAttempt(r); }
    const d = delays(r); expect(d).toHaveLength(10);
    d.forEach((ms, i) => { expect(ms).toBeGreaterThanOrEqual(0); expect(ms).toBeLessThan(Math.min(15_000, 250 * 2 ** i)); });
    expect(r.tickets).toHaveLength(r.srv.sockets.length); expect(new Set(r.tickets).size).toBe(r.tickets.length);
    expect(r.ev.link).toEqual(['offline']); /* a failed attempt is offline at once, and the client keeps trying */
  });
  it('property: across random close codes and rng streams each attempt fetches exactly one new ticket and no delay passes 15 s (plus retry_after)', async () => {
    const backoffCodes = [1000, 1006, 1011, 4408, 4429, 4400, 4999];
    await fc.assert(fc.asyncProperty(fc.array(fc.constantFrom(...backoffCodes), { minLength: 1, maxLength: 12 }), fc.integer({ min: 1, max: 1e6 }), async (codes, seed) => {
      let s0 = seed; const r = rig({ rng: () => { s0 = (Math.imul(s0, 48271) + 11) >>> 0; return (s0 % 1_000_000) / 1_000_000; } }); void r.client.connect();
      let opened = 0;
      for (const code of codes) { const s = await r.nextSocket(); opened++; s.open(); if (code === 4400 && opened % 2) s.receive({ v: 1, t: 'sys.ping', p: {} }); s.serverClose(code); await flush(); if (r.client.state === 'closed') break; await r.clock.advance(15_000); }
      const hellos = r.srv.sockets.flatMap((s) => s.of('sys.hello').map((h) => h.p!.ticket));
      return delays(r).every((d) => d >= 0 && d < 15_000) && new Set(r.tickets).size === r.tickets.length && r.tickets.length === r.srv.sockets.length && new Set(hellos).size === hellos.length;
    }), { seed: 55, numRuns: 60 });
  });
  it('the attempt counter resets after 10 s of ready, so a flapping server does not stay at the cap', async () => {
    const r = rig(); void r.client.connect();
    for (let i = 0; i < 6; i++) { const s = await r.nextSocket(); s.serverClose(1006); await flush(); await toNextAttempt(r); }
    expect(r.client.attempt).toBe(6);
    const s = await r.accept(); await r.clock.advance(9_999); expect(r.client.attempt).toBe(6); await r.clock.advance(1); expect(r.client.attempt).toBe(0);
    s.serverClose(1006); await flush(); expect(delays(r).at(-1)!).toBeLessThan(250);
  });
  it('a connection that drops before 10 s keeps the counter', async () => {
    const r = rig(); void r.client.connect();
    for (let i = 0; i < 3; i++) { const s = await r.nextSocket(); s.serverClose(1006); await flush(); await toNextAttempt(r); }
    const s = await r.accept(); await r.clock.advance(5_000); s.serverClose(1006); await flush(); expect(r.client.attempt).toBe(4);
  });
});

describe('close codes in detail (AC7)', () => {
  for (const code of [4403, 4404, 4426, 4409]) {
    it(`${code} ends in state closed with willReconnect:false and exactly one closed event`, async () => {
      const r = rig(); const p = r.client.connect(); const s = await r.accept(); await p; s.serverClose(code); await flush();
      await r.clock.advance(300_000);
      expect(r.client.state).toBe('closed'); expect(r.ev.closed).toEqual([expect.objectContaining({ code, willReconnect: false })]); expect(r.srv.sockets).toHaveLength(1); expect(r.ev.link).toEqual(['online', 'offline']);
    });
  }
  it('4426 carries the upgrade hint key and connect() rejects when it happens before the first welcome', async () => {
    const r = rig(); const p = r.client.connect(); const s = await r.nextSocket(); s.open();
    s.receive({ v: 1, t: 'sys.error', p: { type: 'x', title: 'old', status: 426, code: 'client_too_old', request_id: 'req_01JA3Z8K2M5N7P9Q0R1S2T3V4W' } }); s.serverClose(4426);
    const e = await p.catch((x: unknown) => x); expect(e).toBeInstanceOf(RelayError); expect((e as RelayError).closeCode).toBe(4426);
    expect(r.ev.closed[0]!.userFacing).toBe('client_too_old'); expect(r.ev.error[0]!.code).toBe('client_too_old');
  });
  it('4401 calls onAuthFailure once and reconnects once; a second consecutive 4401 stops', async () => {
    let calls = 0; const r = rig({ onAuthFailure: async () => { calls++; return true; } }); void r.client.connect(); const s = await r.accept();
    s.serverClose(4401); await flush(); expect(calls).toBe(1); await r.clock.advance(1_000);
    const s2 = await r.nextSocket(); s2.open(); s2.serverClose(4401); await flush(); await r.clock.advance(60_000);
    expect(calls).toBe(1); expect(r.client.state).toBe('closed'); expect(r.srv.sockets).toHaveLength(2);
    expect(r.ev.closed.map((c) => c.willReconnect)).toEqual([true, false]);
  });
  it('4401 after a successful welcome in between counts as new', async () => {
    let calls = 0; const r = rig({ onAuthFailure: async () => { calls++; return true; } }); void r.client.connect(); const s = await r.accept();
    s.serverClose(4401); await flush(); await r.clock.advance(1_000); const s2 = await r.accept(); s2.serverClose(4401); await flush(); await r.clock.advance(1_000);
    expect(calls).toBe(2); expect(r.srv.sockets).toHaveLength(3);
  });
  it('4401 stops when onAuthFailure says no or throws', async () => {
    for (const hook of [async () => false, async () => { throw new Error('refresh failed'); }]) {
      const r = rig({ onAuthFailure: hook }); void r.client.connect(); const s = await r.accept(); s.serverClose(4401); await flush(); await r.clock.advance(60_000);
      expect(r.client.state).toBe('closed'); expect(r.ev.closed).toHaveLength(1); expect(r.ev.closed[0]!.willReconnect).toBe(false);
    }
  });
  it('4503 after sys.error retry_after_s: 20 waits at least 20 s', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept();
    s.receive({ v: 1, t: 'sys.error', p: { type: 'x', title: 'busy', status: 503, code: 'service_unavailable', request_id: 'req_01JA3Z8K2M5N7P9Q0R1S2T3V4W', retry_after_s: 20 } }); s.serverClose(4503); await flush();
    expect(r.ev.error[0]!.retryAfterS).toBe(20); await r.clock.advance(19_999); expect(r.srv.sockets).toHaveLength(1);
    await r.clock.advance(250); expect(r.srv.sockets).toHaveLength(2); expect(delays(r)[0]!).toBeGreaterThanOrEqual(20_000);
  });
  it('4503 without a retry_after_s just backs off', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept(); s.serverClose(4503); await flush(); expect(delays(r)[0]!).toBeLessThan(250);
  });
  it('1001 reconnects within 500 ms with a new ticket; the owner sees reconnecting then online, one welcome per connection', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept(); s.serverClose(1001, 'server_restart'); await flush();
    await r.clock.advance(500); expect(r.srv.sockets).toHaveLength(2); await r.accept();
    expect(r.ev.link).toEqual(['online', 'reconnecting', 'online']); expect(r.ev.welcome).toHaveLength(2); expect(new Set(r.tickets).size).toBe(2);
  });
  it('three 4400 closes within 60 s stop and report a protocol error', async () => {
    const r = rig(); void r.client.connect();
    for (let i = 0; i < 3; i++) { const s = await r.accept(); s.serverClose(4400); await flush(); await r.clock.advance(1_000); }
    expect(r.client.state).toBe('closed'); expect(r.ev.closed.at(-1)!.willReconnect).toBe(false); expect(r.ev.closed.at(-1)!.userFacing).toBe('protocol_violation');
  });
  it('the planner: 4400s spread over more than 60 s keep backing off', () => {
    let t = 0; const p = new ReconnectPlanner(() => 0.5, () => t);
    for (let i = 0; i < 5; i++) { expect(p.decide(4400).reconnect).toBe(true); t += 31_000; }
  });
});

describe('tickets and caller actions', () => {
  it('a ticket fetch that fails on the network is a failed attempt with backoff', async () => {
    let n = 0; const r = rig({ getTicket: async () => { n++; if (n < 3) throw new CentcomError({ kind: 'network' }); return { ticket: `tkt.${n}.SECRET` }; } });
    void r.client.connect(); await flush(); expect(r.client.state).toBe('backoff'); await toNextAttempt(r); await flush(); await toNextAttempt(r); await r.accept();
    expect(n).toBe(3); expect(r.client.state).toBe('ready'); expect(r.ev.link).toEqual(['offline', 'online']);
  });
  it('a ticket fetch refused with 403 (membership revoked) stops with closed(willReconnect:false)', async () => {
    const r = rig({ getTicket: async () => { throw new CentcomError({ kind: 'api', code: 'forbidden', status: 403 }); } });
    const e = await r.client.connect().catch((x: unknown) => x); expect((e as RelayError).localCode).toBe('ticket_failed');
    expect(r.ev.closed).toEqual([{ code: 4403, reason: 'ticket_forbidden', willReconnect: false, userFacing: 'forbidden' }]); expect(r.srv.sockets).toHaveLength(0);
  });
  it('a ticket fetch that hangs is bounded at 10 s', async () => {
    const r = rig({ getTicket: () => new Promise(() => undefined) }); void r.client.connect(); await flush();
    await r.clock.advance(10_000); expect(r.client.state).toBe('backoff');
  });
  it('close() stops for good: one closed event, no reconnect, pending connect() rejects', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept(); await r.client.close();
    expect(s.closeCalls[0]!.code).toBe(1000); expect(r.client.state).toBe('closed'); expect(r.ev.closed).toEqual([{ code: 1000, reason: '', willReconnect: false }]);
    await r.clock.advance(60_000); expect(r.srv.sockets).toHaveLength(1);
    const r2 = rig(); const p = r2.client.connect(); await r2.client.close(); expect(await p.catch((x: RelayError) => x.localCode)).toBe('closed');
  });
  it('close() during backoff cancels the pending attempt', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept(); s.serverClose(1006); await flush(); await r.client.close();
    await r.clock.advance(60_000); expect(r.srv.sockets).toHaveLength(1); expect(r.client.state).toBe('closed');
  });
  it('connect() after close() starts again', async () => {
    const r = rig(); void r.client.connect(); await r.accept(); await r.client.close(); const p = r.client.connect(); await r.accept(); await p; expect(r.client.state).toBe('ready');
  });
  it('reconnect() drops the connection and dials again quickly', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept(); r.client.reconnect(); await flush();
    expect(s.closeCalls[0]!.code).toBe(1000); await r.clock.advance(250); expect(r.srv.sockets).toHaveLength(2); expect(r.client.attempt).toBe(0);
  });
});

describe('against the mock backend scenarios', () => {
  let m: MockBackend | undefined; let client: RelayClient | undefined;
  afterEach(async () => { await client?.close().catch(() => undefined); await m?.stop(); m = undefined; client = undefined; });
  const until = async (c: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!c()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); } };
  async function start(scenario?: string, o: { onAuthFailure?: () => Promise<boolean> } = {}) {
    m = await startMockBackend({ clock: 'virtual', seed: 7, ...(scenario ? { scenario } : {}) }); const mock = m; const tickets: string[] = [];
    client = new RelayClient({ url: mock.wsUrl, allowPlainWs: true, sessionId: SID, clock: mock.clock, rng: () => 0.5, ...o,
      getTicket: async () => { const t = ((await mock.control('ticket', { sid: SID, name: 'Ed', role: 'editor', device: 'dev_01JTEST0000000000000000009' })) as { ticket: string }).ticket; tickets.push(t); return { ticket: t }; }, getLastSeq: () => null, clientInfo: CLIENT });
    const closed: { code: number; willReconnect: boolean }[] = []; const welcomes: unknown[] = []; client.on('closed', (c) => closed.push(c)); client.on('welcome', (w) => welcomes.push(w));
    await client.connect(); return { mock, tickets, closed, welcomes };
  }
  it('forced-disconnect: 1001 reconnects with a new ticket, then 4429 backs off, then 4400 backs off', async () => {
    const { mock, tickets, closed, welcomes } = await start('forced-disconnect');
    await mock.advance(3_000); await until(() => closed.length === 1); await mock.advance(500); await until(() => welcomes.length === 2);
    await until(() => closed.length === 2); expect(closed[1]!.code).toBe(4429); await mock.advance(500); /* small steps: the virtual clock must not outrun a real socket opening */ await until(() => welcomes.length === 3);
    await until(() => closed.length === 3); expect(closed.map((c) => [c.code, c.willReconnect])).toEqual([[1001, true], [4429, true], [4400, true]]);
    expect(new Set(tickets).size).toBe(tickets.length);
  });
  it('superseded: 4409 stops for good', async () => {
    const { mock, closed } = await start('superseded'); await mock.advance(2_000); await until(() => closed.length === 1);
    await mock.advance(60_000); await new Promise((r) => setTimeout(r, 30)); expect(closed).toEqual([expect.objectContaining({ code: 4409, willReconnect: false })]); expect(client!.state).toBe('closed');
  });
  it('ticket-expired: 4401 asks for fresh auth once and reconnects', async () => {
    let calls = 0; const { mock, closed, welcomes } = await start('ticket-expired', { onAuthFailure: async () => { calls++; return true; } });
    await mock.advance(2_000); await until(() => closed.length === 1); await mock.advance(500); await until(() => welcomes.length === 2);
    expect(calls).toBe(1); expect(closed[0]).toMatchObject({ code: 4401, willReconnect: true }); expect(client!.state).toBe('ready');
  });
});
