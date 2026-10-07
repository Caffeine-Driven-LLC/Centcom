import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { validateAgainst } from '@centcom/protocol';
import { startMockBackend, type MockBackend } from '@centcom/testkit';
import { RelayClient, RelayError, buildHello, negotiateCaps, readWelcome, type Welcome } from '../../src/index.js';
import { CLIENT, SID, envelopeFixtures, flush, rig, welcome } from './helpers.js';

describe('hello (AC1, AC8)', () => {
  it('the first frame is one sys.hello with protocols [1], the ticket, last_seq and our client; sent the moment the socket opens', async () => {
    const r = rig({ getLastSeq: () => 1040 }); void r.client.connect(); const s = await r.nextSocket();
    expect(s.sent).toHaveLength(0); s.open();
    expect(s.sent).toHaveLength(1); const hello = s.frames()[0]!;
    expect(hello).toEqual({ v: 1, t: 'sys.hello', p: { protocols: [1], caps: ['resume'], ticket: r.tickets[0], client: CLIENT, last_seq: 1040 } });
    expect(validateAgainst('envelope', hello, 'strict').ok).toBe(true);
    expect(r.client.state).toBe('handshaking');
  });
  it('the URL and the upgrade options never carry the ticket; permessage-deflate is off and maxPayload is 256 KiB', async () => {
    const r = rig(); void r.client.connect(); const s = await r.nextSocket();
    expect(s.url).toBe('wss://relay.centcom.dev/v1/ws'); expect(s.protocols).toEqual(['centcom.v1']);
    expect(JSON.stringify({ url: s.url, opts: s.opts })).not.toContain(r.tickets[0]!);
    expect(s.opts.perMessageDeflate).toBe(false); expect(s.opts.maxPayload).toBe(256 * 1024); expect(s.opts.headers['User-Agent']).toMatch(/^centcom-cli\/1\.4\.2 \(contract\//);
  });
  it('the join-token url wins over the configured one', async () => {
    const r = rig({ getTicket: async () => ({ ticket: 'tkt.region.SECRET', url: 'wss://relay-eu.centcom.dev/v1/ws' }) }); void r.client.connect();
    expect((await r.nextSocket()).url).toBe('wss://relay-eu.centcom.dev/v1/ws');
  });
  it('getLastSeq() is read for every hello', async () => {
    let last: number | null = null; const r = rig({ getLastSeq: () => last }); void r.client.connect();
    const a = await r.accept(); expect(a.frames()[0]!.p!.last_seq).toBeNull();
    last = 17; a.serverClose(1001); await r.clock.advance(300); const b = await r.accept(); expect(b.frames()[0]!.p!.last_seq).toBe(17);
  });
});

describe('real sockets: what goes over the wire', () => {
  let wss: WebSocketServer | undefined; let client: RelayClient | undefined;
  afterEach(async () => { await client?.close().catch(() => undefined); client = undefined; await new Promise<void>((r) => (wss ? wss.close(() => r()) : r())); wss = undefined; });
  const serve = (handleProtocols: (p: Set<string>) => string | false) => new Promise<{ url: string; seen: { req?: IncomingMessage; first?: { text: string; binary: boolean } } }>((res) => {
    const seen: { req?: IncomingMessage; first?: { text: string; binary: boolean } } = {};
    wss = new WebSocketServer({ host: '127.0.0.1', port: 0, handleProtocols });
    wss.on('connection', (ws: WebSocket, req) => { seen.req = req; ws.once('message', (d, binary) => { seen.first = { text: d.toString(), binary }; ws.send(JSON.stringify(welcome())); }); });
    wss.on('listening', () => res({ url: `ws://127.0.0.1:${(wss!.address() as AddressInfo).port}/v1/ws`, seen }));
  });
  const make = (url: string) => new RelayClient({ url, sessionId: SID, allowPlainWs: true, getTicket: async () => ({ ticket: 'tkt.SECRETTICKETVALUE.xyz' }), getLastSeq: () => 5, clientInfo: CLIENT });

  it('the upgrade offers centcom.v1 without deflate and no ticket; the first bytes are one hello text frame', async () => {
    const { url, seen } = await serve((p) => (p.has('centcom.v1') ? 'centcom.v1' : false)); client = make(url);
    const w = await client.connect(); expect(w.member.role).toBe('host');
    expect(seen.req!.headers['sec-websocket-protocol']).toBe('centcom.v1'); expect(seen.req!.headers['sec-websocket-extensions']).toBeUndefined();
    expect(seen.req!.url).toBe('/v1/ws'); expect(JSON.stringify(seen.req!.headers)).not.toContain('SECRETTICKETVALUE'); expect(seen.req!.headers['user-agent']).toMatch(/^centcom-cli\//);
    expect(seen.first!.binary).toBe(false); const hello = JSON.parse(seen.first!.text);
    expect(hello.t).toBe('sys.hello'); expect(hello.p.ticket).toBe('tkt.SECRETTICKETVALUE.xyz'); expect(hello.p.last_seq).toBe(5);
  });
  for (const [what, pick] of [['no subprotocol', () => false], ['another subprotocol', () => 'centcom.v9']] as const) {
    it(`a server that selects ${what} makes connect() reject with a protocol error and gets no hello (AC2)`, async () => {
      const { url, seen } = await serve(pick as (p: Set<string>) => string | false); client = make(url);
      const e = await client.connect().catch((x: unknown) => x); expect(e).toBeInstanceOf(RelayError); expect((e as RelayError).localCode).toBe('subprotocol');
      await new Promise((r) => setTimeout(r, 50)); expect(seen.first).toBeUndefined(); expect(client.state).toBe('closed');
    });
  }
});

describe('subprotocol, protocol and caps (AC2, AC3, AC4)', () => {
  it('a socket that opens without centcom.v1 is closed before any hello and connect() rejects', async () => {
    const r = rig(); const p = r.client.connect(); const s = await r.nextSocket(); s.open('');
    const e = await p.catch((x: unknown) => x); expect((e as RelayError).localCode).toBe('subprotocol'); expect(s.sent).toHaveLength(0);
    await r.clock.advance(60_000); expect(r.srv.sockets).toHaveLength(1); expect(r.ev.closed).toHaveLength(1); expect(r.ev.closed[0]!.willReconnect).toBe(false);
  });
  it('welcome with protocol 2 closes 4400, emits error protocol_mismatch, and never reconnects', async () => {
    const r = rig(); const p = r.client.connect(); const s = await r.nextSocket(); s.open(); s.receive(welcome({ protocol: 2 }));
    const e = await p.catch((x: unknown) => x); expect((e as RelayError).localCode).toBe('protocol_mismatch');
    expect(s.closeCalls[0]!.code).toBe(4400); expect(r.ev.error.map((x) => x.localCode)).toEqual(['protocol_mismatch']);
    await r.clock.advance(120_000); expect(r.srv.sockets).toHaveLength(1); expect(r.client.state).toBe('closed');
    expect(r.ev.closed).toEqual([{ code: 4400, reason: 'protocol_mismatch', willReconnect: false }]);
  });
  it('welcome.caps = [] leaves negotiatedCaps empty, and a frame that needs resume is refused locally', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept({ caps: [] });
    expect(r.client.state).toBe('ready'); expect([...r.client.negotiatedCaps]).toEqual([]);
    const e = await r.client.send({ t: 'sys.resume', sid: SID, p: { last_seq: 3 } }).catch((x: unknown) => x);
    expect((e as RelayError).localCode).toBe('capability_not_negotiated'); expect(s.sent).toHaveLength(1); /* only the hello */
  });
  it('caps used are the intersection; unknown caps are ignored', async () => {
    const r = rig(); void r.client.connect(); await r.accept({ caps: ['future.cap', 'resume'] });
    expect([...r.client.negotiatedCaps]).toEqual(['resume']); expect([...negotiateCaps(['resume', 'cursor.coalesce'], ['cursor.coalesce'])]).toEqual(['cursor.coalesce']);
  });
  it('the welcome is recorded: protocol, member, slot, role, roster_v, heartbeat, limits, resume', async () => {
    const r = rig(); const p = r.client.connect(); await r.accept({ resume: { from_seq: 4 }, limits: { max_frame_bytes: 1000, seq_rate: 5 } });
    const w = (await p) as Welcome;
    expect(w).toMatchObject({ protocol: 1, member: { id: 'mem_01JA3Z8K2M5N7P9Q0R1S2T3V4W', name: 'Alex', slot: 0, role: 'host' }, slot: 0, role: 'host', roster_v: 1, heartbeat: { ping_ms: 20000, dead_ms: 50000 }, resume: { from_seq: 4 } });
    expect(r.client.welcome).toBe(w); expect(r.client.limits.maxFrameBytes).toBe(1000); expect(r.client.limits.seqRate).toBe(5);
    expect(r.ev.link).toEqual(['online']); expect(r.ev.welcome).toHaveLength(1);
  });
  it('connect() twice while connecting or connected opens one socket', async () => {
    const r = rig(); const a = r.client.connect(); const b = r.client.connect(); await r.accept(); await Promise.all([a, b]);
    await r.client.connect(); expect(r.srv.sockets).toHaveLength(1);
  });
  it('readWelcome refuses a protocol we did not offer and a welcome without a member', () => {
    expect(readWelcome(welcome({ protocol: 2 }), [1])).toEqual({ ok: false, reason: 'protocol_mismatch' });
    expect(readWelcome({ ...welcome(), p: { protocol: 1, heartbeat: {} } }, [1])).toEqual({ ok: false, reason: 'invalid_welcome' });
  });
});

describe('welcome timeout (AC8)', () => {
  it('no welcome within 10 s of hello closes the socket and counts as a failed attempt; backoff continues', async () => {
    const r = rig(); void r.client.connect(); const s = await r.nextSocket(); s.open();
    await r.clock.advance(9_999); expect(s.closeCalls).toHaveLength(0);
    await r.clock.advance(1); expect(s.closeCalls[0]!.code).toBe(4408); await flush();
    expect(r.client.state).toBe('backoff'); expect(r.client.attempt).toBe(1); expect(r.ev.closed[0]!.willReconnect).toBe(true); expect(r.ev.link).toEqual(['offline']);
    await r.clock.advance(250); const s2 = await r.nextSocket(); s2.open(); await r.clock.advance(10_000); await flush();
    expect(r.client.attempt).toBe(2); expect(r.tickets).toHaveLength(2);
  });
  it('a socket that never opens is cut after 10 s too', async () => {
    const r = rig(); void r.client.connect(); const s = await r.nextSocket(); await r.clock.advance(10_000);
    expect(s.closeCalls[0]!.code).toBe(4408); await flush(); expect(r.client.state).toBe('backoff');
  });
  it('a server that ignores our close frame is terminated after 3 s', async () => {
    const r = rig(); void r.client.connect(); const s = await r.nextSocket(); s.echoClose = false; s.open();
    await r.clock.advance(10_000); expect(s.closeCalls).toHaveLength(1); expect(s.terminated).toBe(false);
    await r.clock.advance(3_000); expect(s.terminated).toBe(true); expect(r.client.state).toBe('backoff');
  });
});

describe('envelope fixtures (contracts/fixtures/envelope)', () => {
  it('buildHello matches the hello fixture shape and passes the strict schema', () => {
    const fx = envelopeFixtures().find((f) => f.name === 'hello.json')!.data;
    const mine = buildHello({ protocols: [1], caps: ['resume'], ticket: String(fx.p!.ticket), client: fx.p!.client as typeof CLIENT, lastSeq: null });
    expect(mine).toEqual(fx); expect(validateAgainst('envelope', mine, 'strict').ok).toBe(true);
  });
  it('after welcome, valid fixtures are emitted as frames and invalid ones are dropped with a warning; the connection stays up', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept();
    for (const fx of envelopeFixtures()) { if (fx.data.t === 'sys.welcome' || fx.data.t === 'sys.hello') continue; s.receive(fx.data); }
    const valid = envelopeFixtures().filter((f) => f.valid && f.data.t !== 'sys.welcome' && f.data.t !== 'sys.hello').map((f) => f.data.t);
    expect(r.ev.frame.map((f) => f.t).filter((t) => t !== 'sys.welcome')).toEqual(valid);
    /* unknown_type.json is invalid by the strict schema but a newer peer may send it (CT-VER): ignored, no warning */
    expect(r.ev.protocol_warning).toHaveLength(envelopeFixtures().filter((f) => !f.valid && f.data.t !== 'sys.hello' && (f.data.t as string) !== 'nope').length);
    expect(r.ev.error.map((e) => e.code)).toEqual(['queue_full']); expect(s.of('sys.pong')).toEqual([{ v: 1, t: 'sys.pong', p: { t: 1728151661123 } }]);
    expect(r.client.state).toBe('ready'); expect(s.closeCalls).toHaveLength(0);
  });
});

describe('against the mock backend relay', () => {
  let m: MockBackend | undefined; let client: RelayClient | undefined;
  afterEach(async () => { await client?.close().catch(() => undefined); await m?.stop(); m = undefined; client = undefined; });
  it('connects with a mock ticket, gets a welcome for its member and stays ready', async () => {
    m = await startMockBackend({ clock: 'virtual', seed: 7 }); const mock = m;
    client = new RelayClient({ url: mock.wsUrl, allowPlainWs: true, sessionId: SID, clock: mock.clock, getTicket: async () => ({ ticket: ((await mock.control('ticket', { sid: SID, name: 'Ada', role: 'host' })) as { ticket: string }).ticket }), getLastSeq: () => null, clientInfo: CLIENT });
    const w = await client.connect(); expect(w.member.name).toBe('Ada'); expect(w.role).toBe('host'); expect(client.state).toBe('ready');
    expect(mock.relay.connections()).toHaveLength(1);
  });
});
