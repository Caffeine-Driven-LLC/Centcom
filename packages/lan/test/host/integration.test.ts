import { afterEach, describe, expect, it } from 'vitest';
import { RelayClient, ReliableChannel } from '@centcom/net';
import { LoopbackLink } from '../../src/index.js';
import { dev, makeServer, mem, rawClient, tk, type Who } from './helpers.js';

const stops: (() => Promise<void>)[] = []; afterEach(async () => { for (const s of stops.splice(0)) await s(); });
const boot = async (n: number, o: Parameters<typeof makeServer>[0] = {}) => { const h = makeServer(o); for (let i = 2; i < 2 + n; i++) h.tokens.set(tk(`t${i}`), { memberId: mem(i), deviceId: dev(i), name: `M${i}`, role: 'editor' } as Who); const { port } = await h.srv.start(); stops.push(() => h.srv.stop()); return { ...h, port }; };
const guest = (port: number, i: number, o: { last?: () => number | null } = {}) => new RelayClient({ url: `ws://127.0.0.1:${port}`, allowPlainWs: true, sessionId: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', getTicket: async () => ({ ticket: tk(`t${i}`) }), getLastSeq: o.last ?? (() => null), clientInfo: { name: 'centcom-cli', version: '1.0.0', contract: '1.2.0' } });

describe('real guests (the same client the hosted relay uses)', () => {
  it('two RelayClient guests with reliable channels exchange frames through the LAN host, in one order, each frame once; a reconnect resumes from where it was', { timeout: 30_000 }, async () => {
    const { port } = await boot(2); const ca = guest(port, 2); const cb = guest(port, 3); const a = new ReliableChannel({ link: ca, sessionId: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W' }); const b = new ReliableChannel({ link: cb, sessionId: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W' }); const got: string[] = []; b.on('frame', (f) => { if (f.k === 'reaction') got.push(String((f.p as { code: string }).code)); });
    await Promise.all([ca.connect(), cb.connect()]); for (let i = 0; i < 20; i++) await a.send({ t: 'event', k: 'reaction', p: { target: 'msg_AAAAAAAAAAAAAAAAAAAAAAAAAA', code: `c${i}`, op: 'add' } }); await new Promise((r) => setTimeout(r, 200)); expect(got).toEqual(Array.from({ length: 20 }, (_, i) => `c${i}`));
    ca.reconnect(); await new Promise((r) => setTimeout(r, 700)); await a.send({ t: 'event', k: 'reaction', p: { target: 'msg_AAAAAAAAAAAAAAAAAAAAAAAAAA', code: 'after', op: 'add' } }); await new Promise((r) => setTimeout(r, 200)); expect(got.at(-1)).toBe('after'); expect(got.filter((x) => x === 'after')).toHaveLength(1); await ca.close(); await cb.close();
  });
});
describe('the host\'s own member (loopback)', () => {
  it('sends and receives through memory with the same numbering as a socket guest, and a guest sees the host\'s frames', async () => {
    const { port, srv } = await boot(1); const lb: LoopbackLink = srv.createLoopbackLink(); const seen: { k?: string; seq?: number; from?: string }[] = []; lb.on('frame', (f) => seen.push({ k: f.k, seq: f.seq, from: f.from })); lb.connect(null);
    const g = await rawClient(port); g.hello(tk('t2')); await g.wait(() => !!g.welcomed()); await lb.send({ t: 'event', id: 'msg_AAAAAAAAAAAAAAAAAAAAAAAAA1', sid: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', k: 'reaction', p: { target: 'msg_AAAAAAAAAAAAAAAAAAAAAAAAAA', code: 'host', op: 'add' } } as never); await g.wait(() => g.frames.some((f) => f.p?.code === 'host')); g.send({ v: 1, t: 'event', id: 'msg_AAAAAAAAAAAAAAAAAAAAAAAAA2', sid: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', k: 'reaction', p: { target: 'msg_AAAAAAAAAAAAAAAAAAAAAAAAAA', code: 'guest', op: 'add' } }); await new Promise((r) => setTimeout(r, 150));
    const hostFrame = g.frames.find((f) => f.p?.code === 'host')!; expect(hostFrame.from).toBe(mem(1)); expect(seen.map((s) => s.k)).toContain('reaction'); expect(seen.filter((s) => s.k === 'reaction').map((s) => s.from)).toEqual([mem(1), mem(2)]); expect(seen.filter((s) => s.k === 'reaction')[1]!.seq).toBe(hostFrame.seq! + 1); g.close();
  });
});
describe('hooks for the host engine', () => {
  it('the interceptor can accept, reject with a problem body, or replace a frame; broadcast numbers server frames and sendTo reaches one member', async () => {
    const { port, srv } = await boot(2, { interceptor: { onInbound: ({ frame }) => (frame.k === 'reaction' && (frame.p as { code?: string }).code === 'no' ? { reject: { code: 'forbidden', status: 403, title: 'No.' } } : frame.k === 'reaction' && (frame.p as { code?: string }).code === 'swap' ? { replace: [{ ...frame, p: { ...(frame.p as object), code: 'swapped' } } as never] } : 'accept') } });
    const a = await rawClient(port); a.hello(tk('t2')); await a.wait(() => !!a.welcomed()); const b = await rawClient(port); b.hello(tk('t3')); await b.wait(() => !!b.welcomed()); const r = (id: number, code: string) => ({ v: 1, t: 'event', id: `msg_${String(id).padStart(26, 'A')}`.slice(0, 30), sid: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', k: 'reaction', p: { target: 'msg_AAAAAAAAAAAAAAAAAAAAAAAAAA', code, op: 'add' } });
    a.send(r(1, 'ok')); a.send(r(2, 'no')); a.send(r(3, 'swap')); await b.wait(() => b.frames.some((f) => f.p?.code === 'swapped')); expect(b.frames.filter((f) => f.k === 'reaction').map((f) => f.p.code)).toEqual(['ok', 'swapped']); expect(a.byType('sys.error').find((e) => e.p.code === 'forbidden')).toBeTruthy();
    const n = srv.broadcast({ t: 'queue', k: 'queue.state', p: { version: 1, items: [] } } as never); expect(n).toBe(srv.headSeq()); await b.wait(() => b.frames.some((f) => f.k === 'queue.state')); expect(b.frames.find((f) => f.k === 'queue.state')).toMatchObject({ from: 'srv', seq: n }); srv.sendTo(mem(2), { t: 'sys.notice', p: { code: 'hi' } } as never); await a.wait(() => a.frames.some((f) => f.t === 'sys.notice')); expect(b.frames.some((f) => f.t === 'sys.notice')).toBe(false);
    srv.kickConnection(mem(3)); await b.wait(() => b.closed()); expect(b.closes).toEqual([4403]); a.close();
  });
  it('a banned address is refused at the door; pairing frames go to the handler before hello', async () => {
    const calls: string[] = []; const { port } = await boot(1, { bans: { isBanned: (ip) => ip === '127.0.0.1' && calls.includes('ban') }, pairing: { onPairFrame: async (conn, text) => { calls.push(`frame:${JSON.parse(text).t}`); conn.send(JSON.stringify({ t: 'lan.pair.2' })); return calls.length > 1 ? 'done' : 'continue'; }, onClose: () => { calls.push('closed'); } } });
    const p = await rawClient(port); p.send({ t: 'lan.pair.1', x: 1 }); await p.wait(() => p.frames.some((f) => f.t === 'lan.pair.2')); p.send({ t: 'lan.pair.3', x: 2 }); await p.wait(() => p.closed()); expect(calls).toEqual(['frame:lan.pair.1', 'frame:lan.pair.3', 'closed']); expect(p.closes).toEqual([1000]);
    calls.push('ban'); await expect(rawClient(port)).rejects.toBeTruthy();
  });
});
