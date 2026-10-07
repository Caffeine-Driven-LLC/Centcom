import { describe, expect, it } from 'vitest';
import { FrameTooLargeError, MAX_FRAME_BYTES, OUTBOUND_BUFFER_BYTES, OutboundBufferFullError, RelayError, SendLimiter, TokenBucket, limitsFromWelcome, sendClassOf, type OutboundFrame } from '../../src/index.js';
import { ManualClock, SID, flush, rig } from './helpers.js';

const ID = (n: number) => `msg_01JA3Z8K2M5N7P9Q0R1S2T${String(n).padStart(4, '0').replace(/[ILOU]/g, '0')}`;
/** A sealed event whose JSON is exactly `bytes` long. */
function sealedOfSize(bytes: number, n = 1): OutboundFrame {
  const base = { t: 'event' as const, id: ID(n), sid: SID, k: 'message.user', ct: { alg: 'xchacha20poly1305' as const, kid: 'k1', n: 'N'.repeat(32), c: '' }, sig: 'S'.repeat(86) };
  const empty = Buffer.byteLength(JSON.stringify({ ...base, v: 1 })); return { ...base, ct: { ...base.ct, c: 'A'.repeat(bytes - empty) } };
}
const ev = (n: number): OutboundFrame => ({ t: 'event', id: ID(n), sid: SID, k: 'message.user', ct: { alg: 'xchacha20poly1305', kid: 'k1', n: 'N'.repeat(32), c: 'AAAA' }, sig: 'S'.repeat(86) });
const presence = (): OutboundFrame => ({ t: 'presence', sid: SID, k: 'presence.update', p: { status: 'online', activity: 'idle' } });

function limiter(o: { buffered?: () => number } = {}) {
  const clock = new ManualClock(); const writes: { text: string; at: number }[] = [];
  const l = new SendLimiter({ clock, write: async (text) => { writes.push({ text, at: clock.now() }); }, bufferedAmount: o.buffered ?? (() => 0) });
  return { clock, writes, l };
}

describe('token buckets (welcome.limits)', () => {
  it('sequenced frames: burst 100, then 30 per second sustained', async () => {
    const { clock, writes, l } = limiter(); for (let i = 0; i < 250; i++) void l.submit('seq', `s${i}`, 10);
    await flush(); expect(writes).toHaveLength(100);
    await clock.advance(1_000); expect(writes).toHaveLength(130);
    await clock.advance(1_000); expect(writes).toHaveLength(160);
    await clock.advance(3_000); expect(writes).toHaveLength(250);
    expect(writes.map((w) => w.text)).toEqual(Array.from({ length: 250 }, (_x, i) => `s${i}`)); /* order kept */
  });
  it('presence: 10 per second, and a full presence queue never blocks sequenced frames', async () => {
    const { clock, writes, l } = limiter(); for (let i = 0; i < 25; i++) void l.submit('presence', `p${i}`, 10); void l.submit('seq', 'S', 10);
    await flush(); expect(writes.map((w) => w.text)).toContain('S'); expect(writes.filter((w) => w.text.startsWith('p'))).toHaveLength(10);
    await clock.advance(1_000); expect(writes.filter((w) => w.text.startsWith('p'))).toHaveLength(20);
    await clock.advance(500); expect(writes.filter((w) => w.text.startsWith('p'))).toHaveLength(25);
  });
  it('sys.* and ack frames have no bucket', async () => {
    const { writes, l } = limiter(); for (let i = 0; i < 300; i++) void l.submit('other', `a${i}`, 10); await flush(); expect(writes).toHaveLength(300);
    expect(['event', 'queue', 'control'].map(sendClassOf)).toEqual(['seq', 'seq', 'seq']); expect(sendClassOf('presence')).toBe('presence'); expect(sendClassOf('ack')).toBe('other'); expect(sendClassOf('sys.resume')).toBe('other');
  });
  it('limits come from the welcome; unknown keys and bad values fall back; frame size never goes above 256 KiB', () => {
    expect(limitsFromWelcome({ seq_rate: 5, seq_burst: 7, presence_rate: 2, max_frame_bytes: 1000, future: 1 })).toEqual({ seqRate: 5, seqBurst: 7, presenceRate: 2, presenceBurst: 2, maxFrameBytes: 1000 });
    expect(limitsFromWelcome({ seq_rate: -1, seq_burst: 'x', max_frame_bytes: 10 ** 9 })).toEqual({ seqRate: 30, seqBurst: 100, presenceRate: 10, presenceBurst: 10, maxFrameBytes: MAX_FRAME_BYTES });
    expect(limitsFromWelcome(null).seqRate).toBe(30);
  });
  it('the bucket refills to its burst and no further', () => {
    const b = new TokenBucket(30, 100, 0); for (let i = 0; i < 100; i++) expect(b.tryTake(0)).toBe(true); expect(b.tryTake(0)).toBe(false);
    expect(b.msUntilToken(0)).toBe(34); expect(b.tryTake(1_000_000)).toBe(true); let n = 1; while (b.tryTake(1_000_000)) n++; expect(n).toBe(100);
  });
  it('a full socket buffer holds the queue until it drains', async () => {
    let buffered = OUTBOUND_BUFFER_BYTES + 1; const { clock, writes, l } = limiter({ buffered: () => buffered });
    const p = l.submit('other', 'x', 1).catch((e: unknown) => e); expect(await p).toBeInstanceOf(OutboundBufferFullError);
    buffered = 0; l.pauseFor(100); void l.submit('other', 'y', 1); buffered = OUTBOUND_BUFFER_BYTES + 5; await clock.advance(150); expect(writes).toHaveLength(0);
    buffered = 0; await clock.advance(50); expect(writes.map((w) => w.text)).toEqual(['y']);
  });
});

describe('slow_down and the 2 MiB buffer (AC9)', () => {
  it('sys.slow_down {for_ms: 2000} pauses send() for 2000 ms, queues up to 2 MiB, then rejects with OutboundBufferFull', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept();
    s.receive({ v: 1, t: 'sys.slow_down', p: { for_ms: 2000, reason: 'rate' } }); expect(r.ev.slow_down).toEqual([2000]);
    const big = 200 * 1024; const sends: Promise<unknown>[] = []; const settled: unknown[] = [];
    for (let i = 0; i < 10; i++) { const p = r.client.send(sealedOfSize(big, i + 1)); sends.push(p); void p.then(() => settled.push(i)); }
    const over = await r.client.send(sealedOfSize(big, 99)).catch((e: unknown) => e); expect(over).toBeInstanceOf(OutboundBufferFullError);
    await r.clock.advance(1_999); expect(s.sent).toHaveLength(1); expect(settled).toHaveLength(0);
    await r.clock.advance(1); await Promise.all(sends); expect(s.sent).toHaveLength(11); expect(settled).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it('a longer pause already running is kept; the pause is capped at 60 s and cleared by a new connection', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept();
    s.receive({ v: 1, t: 'sys.slow_down', p: { for_ms: 5000 } }); s.receive({ v: 1, t: 'sys.slow_down', p: { for_ms: 1000 } });
    void r.client.send(ev(1)); await r.clock.advance(4_999); expect(s.sent).toHaveLength(1); await r.clock.advance(1); expect(s.sent).toHaveLength(2);
    s.receive({ v: 1, t: 'sys.slow_down', p: { for_ms: 10 ** 9 } }); expect(r.ev.slow_down.at(-1)).toBe(60_000);
    s.serverClose(1001); await flush(); await r.clock.advance(250); const s2 = await r.accept(); void r.client.send(ev(2)); await flush(); expect(s2.sent).toHaveLength(2);
  });
});

describe('send() checks (AC10)', () => {
  it('a 256 KiB + 1 byte frame rejects with FrameTooLargeError and nothing is written; exactly 256 KiB goes out', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept();
    const e = await r.client.send(sealedOfSize(MAX_FRAME_BYTES + 1)).catch((x: unknown) => x); expect(e).toBeInstanceOf(FrameTooLargeError); expect((e as FrameTooLargeError).size).toBe(MAX_FRAME_BYTES + 1);
    expect(s.sent).toHaveLength(1); await r.client.send(sealedOfSize(MAX_FRAME_BYTES)); expect(s.sent).toHaveLength(2); expect(Buffer.byteLength(s.sent[1]!)).toBe(MAX_FRAME_BYTES);
  });
  it('a smaller server max_frame_bytes is honoured', async () => {
    const r = rig(); void r.client.connect(); await r.accept({ limits: { max_frame_bytes: 1000 } });
    expect(await r.client.send(sealedOfSize(1001)).catch((x: unknown) => x)).toBeInstanceOf(FrameTooLargeError);
  });
  it('from, ts and seq are stripped; v is set', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept();
    await r.client.send({ ...ev(1), from: 'mem_01JA3Z8K2M5N7P9Q0R1S2T3V4W', ts: '2026-10-06T12:00:00.000Z', seq: 9 }); const out = s.frames()[1]!;
    expect(out.from).toBeUndefined(); expect(out.ts).toBeUndefined(); expect(out.seq).toBeUndefined(); expect(out.v).toBe(1);
  });
  it('a frame the schema does not allow, a hello, or any send while not ready is refused', async () => {
    const r = rig(); expect(((await r.client.send(ev(1)).catch((x: unknown) => x)) as RelayError).localCode).toBe('not_connected');
    void r.client.connect(); const s = await r.accept();
    expect(await r.client.send({ t: 'event', sid: SID, k: 'message.user', p: {} }).catch((x: Error) => x.name)).toBe('ProtocolError');
    expect(await r.client.send({ t: 'event', id: ID(3), sid: SID, k: 'message.user', bogus: 1 } as OutboundFrame).catch((x: Error) => x.name)).toBe('ProtocolError');
    expect(((await r.client.send({ t: 'sys.hello', p: {} }).catch((x: unknown) => x)) as RelayError).localCode).toBe('not_connected');
    expect(s.sent).toHaveLength(1);
  });
  it('frames still queued when the socket closes are rejected with not_connected', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept(); s.receive({ v: 1, t: 'sys.slow_down', p: { for_ms: 5000 } });
    const p = r.client.send(ev(1)).catch((x: RelayError) => x.localCode); s.serverClose(1006); expect(await p).toBe('not_connected');
  });
  it('a write the socket refuses rejects send()', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept(); s.failSends = true;
    expect(await r.client.send(ev(1)).catch((x: RelayError) => x.localCode)).toBe('not_connected');
  });
});
