import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Frame } from '@centcom/protocol';
import { OutboxFullError, ReliableChannel, createMsgIdGenerator, isMsgId, memorySeqStore, type FrameLink, type SequencedFrame, type Welcome } from '../../src/index.js';
import { ManualClock, MEM, SID, flush } from '../relay/helpers.js';

const welcome = (resume: Record<string, unknown> | null = null): Welcome => ({ protocol: 1, caps: ['resume'], member: { id: MEM, name: 'Ana', slot: 0, role: 'host' }, slot: 0, role: 'host', roster_v: 1, heartbeat: { ping_ms: 15000, dead_ms: 45000 }, limits: {}, resume });
/** A link the test controls: it records what the channel writes and plays the relay. */
class FakeLink {
  sent: Frame[] = []; reconnects = 0; welcome: Welcome | null = null; state = 'open'; failSend: ((f: Frame) => Error | undefined) | undefined; private h: Record<string, ((...a: never[]) => void)[]> = { welcome: [], frame: [], closed: [], link: [] };
  send = async (f: Frame): Promise<void> => { const e = this.failSend?.(f); if (e) throw e; this.sent.push(f); };
  on(ev: string, fn: (...a: never[]) => void) { (this.h[ev] ??= []).push(fn); return () => { this.h[ev] = this.h[ev]!.filter((x) => x !== fn); }; }
  reconnect = () => { this.reconnects++; };
  connect(resume: Record<string, unknown> | null = null) { this.welcome = welcome(resume); for (const f of this.h.welcome!) (f as (w: Welcome) => void)(this.welcome); }
  drop() { for (const f of this.h.closed!) (f as (c: unknown) => void)({ code: 1006, reason: '' }); }
  push(f: Partial<Frame>) { for (const x of this.h.frame!) (x as (f: Frame) => void)({ v: 1, sid: SID, ...f } as Frame); }
  ev(seq: number, o: Partial<Frame> = {}) { this.push({ t: 'event', k: 'message.user', seq, id: `msg_01JTEST0000000000000${String(seq).padStart(6, '0')}`, from: 'mem_01JTEST0000000000000000099', ...o }); }
}
function rig(o: { init?: number; maxUnacked?: number; maxUnackedBytes?: number } = {}) {
  const clock = new ManualClock(); const link = new FakeLink(); const seqs: number[] = []; const store = memorySeqStore(o.init !== undefined ? { [SID]: o.init } : {});
  const ch = new ReliableChannel({ link: link as unknown as FrameLink, sessionId: SID, clock, seqStore: store, maxUnacked: o.maxUnacked, maxUnackedBytes: o.maxUnackedBytes }); ch.on('frame', (f: SequencedFrame) => seqs.push(f.seq)); return { clock, link, ch, seqs, store };
}
const D = (k = 'message.user') => ({ t: 'event' as const, k, p: { text: 'x' } });

describe('order and duplicates', () => {
  it('5,5,6,7,7 after 4 delivers 5,6,7 once each and lastSeq ends at 7', async () => { const r = rig({ init: 4 }); await r.ch.init(); r.link.connect(); for (const s of [5, 5, 6, 7, 7]) r.link.ev(s); expect(r.seqs).toEqual([5, 6, 7]); expect(r.ch.lastSeq()).toBe(7); });
  it('1,2,4,3 comes out as 1,2,3,4', () => { const r = rig(); r.link.connect(); for (const s of [1, 2, 4, 3]) r.link.ev(s); expect(r.seqs).toEqual([1, 2, 3, 4]); });
  it('a seq that never arrives: sys.resume {last_seq: 2} after 5 s, a forced reconnect after 5 s more', async () => {
    const r = rig(); r.link.connect(); for (const s of [1, 2, 4, 5]) r.link.ev(s); expect(r.seqs).toEqual([1, 2]); await r.clock.advance(4999); expect(r.link.sent.some((f) => f.t === 'sys.resume')).toBe(false);
    const gaps: unknown[] = []; r.ch.on('gap', (g) => gaps.push(g)); await r.clock.advance(2); expect(r.link.sent.find((f) => f.t === 'sys.resume')).toMatchObject({ p: { last_seq: 2 } }); expect(gaps).toEqual([{ expected: 3, got: 4 }]); expect(r.link.reconnects).toBe(0); await r.clock.advance(5000); expect(r.link.reconnects).toBe(1);
  });
  it('the hold buffer is bounded: the 1,001st waiting frame triggers a reconnect', () => { const r = rig(); r.link.connect(); r.link.ev(1); for (let s = 3; s < 3 + 1000; s++) r.link.ev(s); expect(r.link.reconnects).toBe(0); r.link.ev(1003); expect(r.link.reconnects).toBe(1); expect(r.seqs).toEqual([1]); });
});

describe('acks', () => {
  it('100 frames in a second: an ack after frame 64, the rest within 5 s; with nothing coming in no standalone ack is sent', async () => {
    const r = rig(); r.link.connect(); const acks = () => r.link.sent.filter((f) => f.t === 'ack').map((f) => f.ack); for (let s = 1; s <= 100; s++) r.link.ev(s); await flush();
    expect(acks()).toEqual([64]); await r.clock.advance(5000); expect(acks()).toEqual([64, 100]); const n = r.link.sent.length; await r.clock.advance(60_000); expect(r.link.sent.length).toBe(n);
  });
  it('every outbound frame carries the ack of what was processed', async () => { const r = rig(); r.link.connect(); r.link.ev(1); r.link.ev(2); void r.ch.send(D()); await flush(); expect(r.link.sent.at(-1)).toMatchObject({ t: 'event', ack: 2 }); });
});

describe('sending and resending', () => {
  it('four unacked frames are resent in order with the same ids after a reconnect; echoes resolve each send with its seq', async () => {
    const r = rig(); r.link.connect(); const ps = [0, 1, 2, 3].map((i) => r.ch.send({ ...D(), p: { i } })); await flush(); const ids = r.link.sent.filter((f) => f.t === 'event').map((f) => f.id); expect(ids).toHaveLength(4); expect(r.ch.pending()).toBe(4);
    r.link.drop(); r.link.sent = []; r.link.connect(); await flush(); expect(r.link.sent.filter((f) => f.t === 'event').map((f) => f.id)).toEqual(ids);
    ids.forEach((id, i) => r.link.push({ t: 'event', k: 'message.user', id, seq: i + 1, from: MEM })); const out = await Promise.all(ps); expect(out.map((x) => x.seq)).toEqual([1, 2, 3, 4]); expect(out.map((x) => x.id)).toEqual(ids); expect(r.ch.pending()).toBe(0); await r.ch.drain(1000);
  });
  it('an unechoed frame is sent again after 30 s (up to 3 times) and then reported stuck', async () => {
    const r = rig(); r.link.connect(); const stuck: unknown[] = []; r.ch.on('stuck', (s) => stuck.push(s)); void r.ch.send(D()); await flush(); const count = () => r.link.sent.filter((f) => f.t === 'event').length; expect(count()).toBe(1);
    for (let i = 0; i < 3; i++) await r.clock.advance(30_000); expect(count()).toBe(4); await r.clock.advance(30_000); expect(stuck).toHaveLength(1); expect(count()).toBe(4);
  });
  it('ids are strictly increasing over 10,000 in one millisecond, and look like msg_<ULID>', () => { const g = createMsgIdGenerator({ now: () => 1_700_000_000_000 }); let prev = ''; for (let i = 0; i < 10_000; i++) { const id = g.next('msg'); expect(isMsgId(id)).toBe(true); expect(id > prev).toBe(true); prev = id; } });
  it('send() rejects when 1,000 frames or 8 MiB are waiting; presence is never kept or resent', async () => {
    const r = rig({ maxUnacked: 3 }); for (let i = 0; i < 3; i++) void r.ch.send(D()); await expect(r.ch.send(D())).rejects.toBeInstanceOf(OutboxFullError);
    const big = rig({ maxUnackedBytes: 500 }); void big.ch.send({ ...D(), p: { t: 'x'.repeat(300) } }); await expect(big.ch.send({ ...D(), p: { t: 'y'.repeat(300) } })).rejects.toBeInstanceOf(OutboxFullError);
    const p = rig(); p.link.connect(); p.ch.sendEphemeral({ t: 'presence', k: 'cursor', p: { x: 1 } }); expect(p.ch.pending()).toBe(0); p.link.drop(); p.link.sent = []; p.link.connect(); expect(p.link.sent.filter((f) => f.t === 'presence')).toEqual([]); const off = rig(); off.ch.sendEphemeral({ t: 'presence', k: 'cursor' }); expect(off.link.sent).toEqual([]);
    expect(() => p.ch.sendEphemeral({ t: 'event' } as never)).toThrow(TypeError); await expect(p.ch.send({ t: 'presence' } as never)).rejects.toBeInstanceOf(TypeError);
  });
  it('drain waits for the echoes and times out with a clear error', async () => { const r = rig(); r.link.connect(); void r.ch.send(D()); await flush(); const d = r.ch.drain(2000); const assertion = expect(d).rejects.toMatchObject({ message: expect.stringContaining('unacked') }); await r.clock.advance(2001); await assertion; });
});

describe('resume', () => {
  it('inside the hot buffer: the replayed frames arrive and sys.resumed is checked; a count mismatch emits gap and reconnects', async () => {
    const r = rig({ init: 10 }); await r.ch.init(); const resumed: unknown[] = []; r.ch.on('resumed', (x) => resumed.push(x)); r.link.connect({ from_seq: 11 }); r.link.ev(11); r.link.ev(12); r.link.ev(13); r.link.push({ t: 'sys.resumed', p: { from_seq: 11, to_seq: 13, count: 3 } }); expect(r.seqs).toEqual([11, 12, 13]); expect(resumed).toEqual([{ fromSeq: 11, toSeq: 13, count: 3 }]);
    const m = rig({ init: 10 }); await m.ch.init(); const gaps: unknown[] = []; m.ch.on('gap', (g) => gaps.push(g)); m.link.connect({ from_seq: 11 }); m.link.ev(11); m.link.push({ t: 'sys.resumed', p: { from_seq: 11, to_seq: 13, count: 3 } }); expect(gaps.length).toBe(1); expect(m.link.reconnects).toBe(1);
  });
  it('a snapshot is needed: it says so and holds delivery until resumeFrom(900); then 901 on', async () => {
    const r = rig({ init: 5 }); await r.ch.init(); const snaps: unknown[] = []; r.ch.on('snapshot-required', (s) => snaps.push(s)); r.link.connect({ snapshot_required: true }); r.link.push({ t: 'sys.resumed', p: { snapshot_required: true, snapshot_seq: 900 } }); expect(snaps).toEqual([{ snapshotSeq: 900 }]); r.link.ev(901); r.link.ev(902); expect(r.seqs).toEqual([]);
    await r.ch.resumeFrom(900); expect(r.seqs).toEqual([901, 902]); expect(r.ch.lastSeq()).toBe(902); expect(r.link.sent.find((f) => f.t === 'sys.resume')).toMatchObject({ p: { last_seq: 900 } }); r.link.ev(903); expect(r.seqs).toEqual([901, 902, 903]);
  });
  it('REST history 901..950 and then replay 940..960 deliver 901..960 exactly once', async () => {
    const r = rig({ init: 900 }); await r.ch.init(); r.link.connect(); const hist = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => ({ v: 1, t: 'event', sid: SID, k: 'message.user', seq: a + i, id: `msg_01JTEST0000000000000${String(a + i).padStart(6, '0')}`, from: 'mem_01JTEST0000000000000000099' })); expect(r.ch.applyHistory(hist(901, 950))).toBe(50);
    for (let s = 940; s <= 960; s++) r.link.ev(s); expect(r.seqs).toEqual(Array.from({ length: 60 }, (_, i) => 901 + i)); expect(r.ch.applyHistory(['junk', 5, { t: 'event' }])).toBe(0);
  });
  it('when the relay\'s own frames come back with a lower seq than ours, it was reset: the channel forgets its position and reconnects', async () => { const r = rig({ init: 50 }); await r.ch.init(); r.link.connect(); void r.ch.send(D()); await flush(); const id = r.link.sent.find((f) => f.t === 'event')!.id!; const gaps: unknown[] = []; r.ch.on('gap', (g) => gaps.push(g)); r.link.push({ t: 'event', k: 'message.user', id, seq: 3, from: MEM }); expect(r.link.reconnects).toBe(1); expect(r.ch.lastSeq()).toBeNull(); expect(gaps).toHaveLength(1); });
  it('the position is saved, and a failing store means a fresh start', async () => { const r = rig(); r.link.connect(); r.link.ev(1); r.link.ev(2); await r.clock.advance(5000); await flush(); expect(r.store.snapshot()[SID]).toBe(2); const bad = new ReliableChannel({ link: new FakeLink() as unknown as FrameLink, sessionId: SID, seqStore: { load: async () => { throw new Error('disk'); }, save: async () => undefined } }); await bad.init(); expect(bad.lastSeq()).toBeNull(); });
});

describe('property: any schedule of drops, duplicates, reordering and disconnects', () => {
  it('delivers the gap-free prefix in order, once each', () => {
    fc.assert(fc.property(fc.array(fc.record({ seq: fc.integer({ min: 1, max: 30 }), dup: fc.boolean(), cut: fc.boolean() }), { minLength: 1, maxLength: 80 }), (steps) => {
      const r = rig(); void r.ch.resumeFrom(0); r.link.connect(); for (const s of steps) { r.link.ev(s.seq); if (s.dup) r.link.ev(s.seq); if (s.cut) { r.link.drop(); r.link.connect(); } }
      for (let i = 0; i < r.seqs.length; i++) expect(r.seqs[i]).toBe(i + 1); const seen = new Set(steps.map((s) => s.seq)); let n = 0; while (seen.has(n + 1)) n++; expect(r.seqs).toHaveLength(n); expect(r.ch.lastSeq()).toBe(n);
    }), { numRuns: 1000 });
  });
});
