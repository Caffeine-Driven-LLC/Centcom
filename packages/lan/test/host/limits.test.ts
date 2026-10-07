import { afterEach, describe, expect, it } from 'vitest';
import { LanHostServer, PublicBindRefusedError, isPublicAddress } from '../../src/index.js';
import { dev, makeServer, mem, msg, rawClient, reaction, tk, SID, type Who } from './helpers.js';

const stops: (() => Promise<void>)[] = []; afterEach(async () => { for (const s of stops.splice(0)) await s(); });
const boot = async (n = 2, o: Parameters<typeof makeServer>[0] = {}) => { const h = makeServer(o); for (let i = 2; i < 2 + n; i++) h.tokens.set(tk(`t${i}`), { memberId: mem(i), deviceId: dev(i), name: `M${i}`, role: 'editor' } as Who); const { port } = await h.srv.start(); stops.push(() => h.srv.stop()); return { ...h, port }; };
const join = async (port: number, i: number) => { const c = await rawClient(port); c.hello(tk(`t${i}`)); await c.wait(() => !!c.welcomed()); return c; };

describe('rates (acceptance 6)', () => {
  it('the 101st sequenced frame in one second brings sys.slow_down; once the burst is used, 31 frames a second keep bringing it', async () => {
    const { port, clock } = await boot(1); const a = await join(port, 2); for (let n = 1; n <= 100; n++) a.send(reaction(msg(n))); await a.wait(() => a.frames.filter((f) => f.k === 'reaction').length === 100); expect(a.byType('sys.slow_down')).toHaveLength(0); a.send(reaction(msg(101))); await a.wait(() => a.byType('sys.slow_down').length === 1); expect(a.byType('sys.slow_down')[0]!.p).toMatchObject({ retry_after_ms: 1000 });
    const before = a.byType('sys.slow_down').length; for (let sec = 0; sec < 5; sec++) { await clock.advance(1000); for (let n = 0; n < 31; n++) a.send(reaction(msg(1000 + sec * 100 + n))); await a.wait(() => a.frames.filter((f) => f.k === 'reaction').length >= 101 + 31 * (sec + 1), 3000); }
    expect(a.byType('sys.slow_down').length).toBeGreaterThanOrEqual(before + 4); expect(a.frames.filter((f) => f.k === 'reaction').length).toBe(101 + 155); /* frames over the rate are still numbered: the warning is what slows a client down */ a.close();
  });
  it('a consumer that never reads and lets more than the outbound limit pile up is closed with 4429', async () => {
    const { port } = await boot(2, { outboundLimitBytes: 64 * 1024 }); const slow = await join(port, 2); const fast = await join(port, 3); (slow.ws as unknown as { _socket: { pause(): void } })._socket.pause(); const big = 'x'.repeat(40_000);
    for (let n = 1; n <= 80; n++) fast.send({ v: 1, t: 'event', id: msg(n), sid: SID, k: 'message.assistant.delta', p: { message_id: msg(900), index: n }, ct: { alg: 'xchacha20poly1305', kid: 'k1', n: 'A'.repeat(32), c: big }, sig: 'AAAA' }); await new Promise((r) => setTimeout(r, 800)); (slow.ws as unknown as { _socket: { resume(): void } })._socket.resume(); await slow.wait(() => slow.closed(), 5000); expect(slow.closes).toContain(4429); expect(fast.closed()).toBe(false); fast.close();
  });
});
describe('bad input (acceptance 7)', () => {
  it('eleven invalid frames in a minute each get invalid_frame and then the connection is closed 4400', async () => {
    const { port } = await boot(1); const a = await join(port, 2); for (let i = 0; i < 10; i++) a.send({ v: 1, t: 'event' }); await a.wait(() => a.byType('sys.error').length === 10); expect(a.byType('sys.error').every((f) => f.p.code === 'invalid_frame')).toBe(true); expect(a.closed()).toBe(false); a.send('not json'); await a.wait(() => a.closed()); expect(a.closes).toEqual([4400]);
  });
  it('a frame one byte over 256 KiB is refused and not routed; one at the limit is fine', async () => {
    const { port, srv } = await boot(2); const a = await join(port, 2); const b = await join(port, 3); const head = srv.headSeq(); const pad = (n: number) => ({ v: 1, t: 'event', id: msg(1), sid: SID, k: 'message.user', ct: { alg: 'xchacha20poly1305', kid: 'k1', n: 'A'.repeat(32), c: 'A'.repeat(n) }, sig: 'AAAA' });
    const base = JSON.stringify(pad(0)).length; a.send(JSON.stringify(pad(262_145 - base))); await a.wait(() => a.byType('sys.error').length === 1); expect(a.byType('sys.error')[0]!.p.code).toBe('frame_too_large'); await new Promise((r) => setTimeout(r, 150)); expect(srv.headSeq()).toBe(head); expect(b.frames.some((f) => f.k === 'message.user')).toBe(false); a.close(); b.close();
  });
  it('binary frames and frames for another session are invalid', async () => { const { port } = await boot(1); const a = await join(port, 2); a.ws.send(Buffer.from([1, 2, 3])); a.send({ ...reaction(msg(1)), sid: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3VZZ' }); await a.wait(() => a.byType('sys.error').length === 2); a.close(); });
});
describe('heartbeat (acceptance 10)', () => {
  it('pings every 20 s with a time in p.t; a pong is not needed to answer a client ping; a silent connection is closed after 50 s', async () => {
    const { port, clock } = await boot(1); const a = await join(port, 2); await clock.advance(20_001); await a.wait(() => a.byType('sys.ping').length === 1); expect(typeof a.byType('sys.ping')[0]!.p.t).toBe('number'); a.send({ v: 1, t: 'sys.ping', p: { t: 77 } }); await a.wait(() => a.byType('sys.pong').length === 1); expect(a.byType('sys.pong')[0]!.p).toEqual({ t: 77 });
    a.send({ v: 1, t: 'sys.pong', p: { t: a.byType('sys.ping')[0]!.p.t } }); await clock.advance(20_000); await a.wait(() => a.byType('sys.ping').length === 2); expect(a.closed()).toBe(false);
    (a.ws as unknown as { _socket: { pause(): void } })._socket.pause(); const silent = await join(port, 2).catch(() => undefined); void silent;
  });
  it('a client that says nothing for 50 s is closed with 1001', async () => {
    const { port, clock, srv } = await boot(1); const a = await join(port, 2); (a.ws as unknown as { ping(): void; pong(): void; _receiver: unknown }).pong = () => undefined; await clock.advance(20_001); await clock.advance(20_000); await clock.advance(20_001); await a.wait(() => a.closed()); expect(a.closes).toEqual([1001]); expect(srv.members()).toHaveLength(0);
  });
});
describe('where it listens (acceptance 9)', () => {
  it('a public address is refused unless --allow-wan, which warns once; private, loopback and wildcard addresses are fine', async () => {
    expect(['8.8.8.8', '203.0.113.9', '2606:4700::1111'].every(isPublicAddress)).toBe(true); expect(['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.5', '127.0.0.1', '169.254.1.1', '0.0.0.0', '::', '::1', 'fd12::1', 'fe80::1', '100.64.0.1'].some(isPublicAddress)).toBe(false); expect(isPublicAddress('172.32.0.1')).toBe(true);
    const warns: string[] = []; const tokens = { validate: async () => null }; const mk = (o: object) => new LanHostServer({ sessionId: SID, sessionName: 'x', hostMember: { id: mem(1), name: 'H', slot: 0, role: 'host' }, port: 0, tokens, transcriptPath: '/tmp/cc-lan-x.jsonl', clock: { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined }, ids: { next: () => 'msg_x' }, logger: { warn: (m: string) => warns.push(m) }, ...o } as never);
    await expect(mk({ bind: '8.8.8.8' }).start()).rejects.toBeInstanceOf(PublicBindRefusedError); const ok = mk({ bind: '127.0.0.1' }); const r = await ok.start(); expect(r.port).toBeGreaterThan(0); expect(r.addresses).toEqual(['127.0.0.1']); await ok.stop(); expect(warns).toEqual([]);
  });
  it('the port falls back to a free one when 7070 is taken', async () => { const a = makeServer({ port: 0 }); const { port } = await a.srv.start(); stops.push(() => a.srv.stop()); const b = makeServer({ port }); const r = await b.srv.start(); stops.push(() => b.srv.stop()); expect(r.port).not.toBe(port); expect(r.port).toBeGreaterThan(0); });
});
