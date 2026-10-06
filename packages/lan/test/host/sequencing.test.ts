import { readFileSync, statSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { dev, makeServer, mem, msg, rawClient, reaction, tk, type Who } from './helpers.js';

const stops: (() => Promise<void>)[] = []; afterEach(async () => { for (const s of stops.splice(0)) await s(); });
const boot = async (n = 3, o: Parameters<typeof makeServer>[0] = {}) => { const h = makeServer(o); for (let i = 2; i < 2 + n; i++) h.tokens.set(tk(`t${i}`), { memberId: mem(i), deviceId: dev(i), name: `M${i}`, role: 'editor' } as Who); const { port } = await h.srv.start(); stops.push(() => h.srv.stop()); return { ...h, port }; };
const join = async (port: number, i: number, last: number | null = null) => { const c = await rawClient(port); c.hello(tk(`t${i}`), last); await c.wait(() => !!c.welcomed()); return c; };

describe('one order for everyone (acceptance 3, 4)', () => {
  it('three guests sending 100 frames each all see the same seq 1..N with no gaps; echoes carry the seq; from, seq and ts claimed by a client are ignored', { timeout: 30_000 }, async () => {
    const { port, srv } = await boot(); const cs = [await join(port, 2), await join(port, 3), await join(port, 4)]; await cs[0]!.wait(() => cs[0]!.byType('control').length >= 3); const base = srv.headSeq();
    cs.forEach((c, i) => { for (let n = 0; n < 100; n++) c.send(reaction(msg(i * 1000 + n + 1), { from: mem(9), seq: 999999, ts: '1999-01-01T00:00:00.000Z' })); });
    await Promise.all(cs.map((c) => c.wait(() => c.seqs().filter((s) => s > base).length >= 300, 8000))); const seqOf = (c: (typeof cs)[0]) => c.seqs().filter((s) => s > base); const expected = Array.from({ length: 300 }, (_, i) => base + i + 1); for (const c of cs) expect(seqOf(c)).toEqual(expected);
    const order = (c: (typeof cs)[0]) => c.frames.filter((f) => f.seq > base).map((f) => `${f.seq}:${f.id}`); expect(order(cs[1]!)).toEqual(order(cs[0]!)); expect(order(cs[2]!)).toEqual(order(cs[0]!)); const mine = cs[0]!.frames.filter((f) => f.seq > base && f.from === mem(2)); expect(mine).toHaveLength(100); expect(mine.every((f) => f.id.startsWith('msg_') && f.ts !== '1999-01-01T00:00:00.000Z' && f.from === mem(2))).toBe(true); expect(cs[0]!.frames.some((f) => f.from === mem(9) || f.seq === 999999)).toBe(false); for (const c of cs) c.close();
  });
  it('a frame id sent again gets its first number and no new one', async () => {
    const { port, srv } = await boot(1); const a = await join(port, 2); a.send(reaction(msg(7))); await a.wait(() => a.frames.some((f) => f.id === msg(7))); const first = a.frames.find((f) => f.id === msg(7))!.seq; const head = srv.headSeq(); a.send(reaction(msg(7))); await a.wait(() => a.frames.filter((f) => f.id === msg(7)).length === 2); expect(a.frames.filter((f) => f.id === msg(7)).map((f) => f.seq)).toEqual([first, first]); expect(srv.headSeq()).toBe(head); a.close();
  });
  it('an unknown kind is numbered and forwarded; server-only kinds from a client are ignored', async () => {
    const { port, srv } = await boot(2); const a = await join(port, 2); const b = await join(port, 3); a.send({ v: 1, t: 'event', id: msg(1), sid: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', k: 'future.thing', p: { x: 1 } }); await b.wait(() => b.frames.some((f) => f.k === 'future.thing')); const h = srv.headSeq(); a.send({ v: 1, t: 'control', id: msg(2), sid: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', k: 'control.roster', p: { version: 99, members: [] } }); await new Promise((r) => setTimeout(r, 150)); expect(srv.headSeq()).toBe(h); a.close(); b.close();
  });
});
describe('resume (acceptance 5)', () => {
  it('last_seq 250 with head 300 replays 251..300 in order, then sys.resumed with the range', async () => {
    const { port, srv } = await boot(2); const a = await join(port, 2); for (let n = 1; n <= 300; n++) srv.broadcast({ t: 'event', k: 'reaction', id: msg(n), p: { target: msg(999), code: 'ok', op: 'add' } } as never); const head = srv.headSeq(); const b = await join(port, 3, head - 50); await b.wait(() => b.byType('sys.resumed').length === 1); expect(b.seqs().filter((s) => s > head - 50 && s <= head)).toEqual(Array.from({ length: 50 }, (_, i) => head - 49 + i)); expect(b.byType('sys.resumed')[0]!.p).toEqual({ from_seq: head - 49, to_seq: head, count: 50 }); expect(b.welcomed()!.p.resume).toEqual({ from_seq: head - 49 }); a.close(); b.close();
  });
  it('with the buffer cut to 10 frames the guest is told a snapshot is needed, and lan.snapshot.get returns the provider\'s bytes', async () => {
    const bytes = Uint8Array.from({ length: 300_000 }, (_, i) => i % 251); const { port, srv } = await boot(1, { replayMinFrames: 10, replayMinMs: 0, snapshots: { get: async () => ({ seq: 280, bytes }) } }); for (let n = 1; n <= 300; n++) srv.broadcast({ t: 'event', k: 'reaction', id: msg(n), p: { target: msg(999), code: 'ok', op: 'add' } } as never);
    await srv.stop().catch(() => undefined); stops.pop(); const h2 = makeServer({ replayMinFrames: 10, replayMinMs: 0, snapshots: { get: async () => ({ seq: 280, bytes }) } }); h2.tokens.set(tk('t2'), { memberId: mem(2), deviceId: dev(2), name: 'M2', role: 'editor' }); const { port: p2 } = await h2.srv.start(); stops.push(() => h2.srv.stop()); for (let n = 1; n <= 300; n++) h2.srv.broadcast({ t: 'event', k: 'reaction', id: msg(n), p: { target: msg(999), code: 'ok', op: 'add' } } as never); void port;
    const c = await join(p2, 2, 5); await c.wait(() => c.byType('sys.resumed').length === 1); expect(c.byType('sys.resumed')[0]!.p).toEqual({ snapshot_required: true, snapshot_seq: 300 }); expect(c.welcomed()!.p.resume).toMatchObject({ snapshot_required: true }); c.send({ t: 'lan.snapshot.get' }); await c.wait(() => c.frames.some((f) => f.t === 'lan.snapshot.end'), 5000);
    const chunks = c.frames.filter((f) => f.t === 'lan.snapshot.chunk'); const got = Buffer.concat(chunks.map((f) => Buffer.from(f.b64, 'base64'))); expect(c.frames.find((f) => f.t === 'lan.snapshot.begin')).toMatchObject({ seq: 280, size: 300_000 }); expect(Buffer.compare(got, Buffer.from(bytes))).toBe(0); c.close();
  });
  it('no snapshot provider or no snapshot answers with an error, not silence', async () => { const { port } = await boot(1); const c = await join(port, 2); c.send({ t: 'lan.snapshot.get' }); await c.wait(() => c.frames.some((f) => f.t === 'lan.snapshot.none')); c.close(); });
});
describe('the transcript (acceptance 11)', () => {
  it('every sequenced frame is in a 0600 JSONL file exactly as it went out, ciphertext included', async () => {
    const { port, srv, transcriptPath, readTranscript } = await boot(1); const a = await join(port, 2); a.send({ v: 1, t: 'event', id: msg(1), sid: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', k: 'message.user', ct: { alg: 'xchacha20poly1305', kid: 'k1', n: 'A'.repeat(32), c: 'QUJDREVGRw' }, sig: 'AAAA' }); a.send(reaction(msg(2))); await a.wait(() => a.frames.filter((f) => f.k === 'message.user' || f.k === 'reaction').length === 2); await srv.stop(); stops.pop();
    const lines = readTranscript(); expect(lines.map((l) => l.k)).toEqual(['control.member_joined', 'message.user', 'reaction']); expect(lines.map((l) => l.seq)).toEqual([1, 2, 3]); expect(lines[1].ct.c).toBe('QUJDREVGRw'); expect(statSync(transcriptPath).mode & 0o777).toBe(0o600); expect(readFileSync(transcriptPath, 'utf8')).not.toContain('presence');
  });
});
