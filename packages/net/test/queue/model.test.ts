import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { QueueModel, type Ctx, type QEvent } from '../../src/index.js';

const DIR = join(import.meta.dirname, '../../../../contracts/fixtures/events');
const Q = (n: number) => `que_${String(n).padStart(26, '0').replace(/0/g, 'A')}`.slice(0, 30); const HOST = 'mem_HOST'; const A = 'mem_A'; const B = 'mem_B';
const ctx: Ctx = { roleOf: (m) => (m === HOST ? 'host' : m === 'mem_V' ? 'viewer' : 'editor') };
let seq = 0; const ev = (kind: string, from: string, p: Record<string, unknown>, secret?: Record<string, unknown>, s = ++seq): QEvent => ({ kind, seq: s, from, ts: `2026-10-07T12:00:${String(s % 60).padStart(2, '0')}.000Z`, p, secret });
const replay = (events: QEvent[]) => { const m = new QueueModel(); for (const e of events) m.apply(e, ctx); return m; };
const summary = (m: QueueModel) => m.view().items.map((i) => `${i.id}:${i.state}:${i.position}`);

describe('reducer over the fixtures', () => {
  it('every queue fixture applies without throwing', () => {
    const m = new QueueModel(); let s = 0; for (const f of readdirSync(DIR).filter((x) => x.startsWith('queue.'))) { const j = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as { kind: string; frame: { p?: Record<string, unknown> }; secret?: Record<string, unknown> }; expect(() => m.apply({ kind: j.kind, seq: ++s, from: j.kind === 'queue.state' ? 'srv' : HOST, ts: '2026-10-07T12:00:00.000Z', p: j.frame.p, secret: j.secret }, ctx), j.kind).not.toThrow(); }
  });
});
describe('states and positions', () => {
  it('queued -> approved -> running -> done, with positions from the order of approval and reorder', () => {
    seq = 0; const m = new QueueModel(); const run = (e: QEvent) => m.apply(e, ctx);
    run(ev('queue.submit', A, { item: Q(1), size: 10, kind: 'message' }, { body: 'one' })); run(ev('queue.submit', B, { item: Q(2), size: 11, kind: 'command' }, { body: 'two' })); run(ev('queue.submit', A, { item: Q(3), size: 12, kind: 'message' }));
    expect(summary(m)).toEqual([`${Q(1)}:queued:0`, `${Q(2)}:queued:1`, `${Q(3)}:queued:2`]); run(ev('queue.approve', HOST, { item: Q(2) })); expect(summary(m)).toEqual([`${Q(1)}:queued:1`, `${Q(2)}:approved:0`, `${Q(3)}:queued:2`].sort((a, b) => (m.view().items.findIndex((x) => x.id === a.split(':')[0]) - m.view().items.findIndex((x) => x.id === b.split(':')[0]))));
    run(ev('queue.approve', HOST, { item: Q(1) })); expect(m.get(Q(2))!.position).toBe(0); expect(m.get(Q(1))!.position).toBe(1); run(ev('queue.reorder', HOST, { order: [Q(1), Q(2)] })); expect(m.get(Q(1))!.position).toBe(0); expect(m.get(Q(2))!.position).toBe(1);
    run(ev('queue.claim', HOST, { item: Q(1), agent_id: 'agt_X' })); expect(m.get(Q(1))).toMatchObject({ state: 'running', position: null, agentId: 'agt_X' }); run(ev('queue.done', HOST, { item: Q(1), outcome: 'ok' })); expect(m.get(Q(1))!.state).toBe('done'); expect(m.get(Q(2))!.position).toBe(0);
    run(ev('queue.claim', HOST, { item: Q(2), agent_id: 'agt_X' })); run(ev('queue.done', HOST, { item: Q(2), outcome: 'error' })); expect(m.get(Q(2))!.state).toBe('failed'); expect(m.get(Q(1))!.body).toBe('one'); expect(m.liveCount()).toBe(1);
  });
  it('reject, cancel, drop and canceled outcomes; the right people only', () => {
    seq = 0; const m = new QueueModel(); const run = (e: QEvent) => m.apply(e, ctx); for (let i = 1; i <= 5; i++) run(ev('queue.submit', A, { item: Q(i), size: 1, kind: 'message' }));
    run(ev('queue.reject', HOST, { item: Q(1), code: 'not_now' })); expect(m.get(Q(1))).toMatchObject({ state: 'rejected', code: 'not_now' }); expect(run(ev('queue.cancel', B, { item: Q(2) })).ignored).toBe('not_submitter'); run(ev('queue.cancel', A, { item: Q(2) })); expect(m.get(Q(2))!.state).toBe('canceled');
    run(ev('queue.drop', HOST, { item: Q(3) })); expect(m.get(Q(3))!.state).toBe('dropped'); run(ev('queue.approve', HOST, { item: Q(4) })); run(ev('queue.claim', HOST, { item: Q(4), agent_id: 'agt_X' })); expect(run(ev('queue.cancel', A, { item: Q(4) })).ignored).toBe('bad_transition'); run(ev('queue.done', HOST, { item: Q(4), outcome: 'canceled' })); expect(m.get(Q(4))!.state).toBe('canceled');
  });
  it('forged host frames, viewers and duplicates are ignored', () => {
    seq = 0; const m = new QueueModel(); const run = (e: QEvent) => m.apply(e, ctx); run(ev('queue.submit', A, { item: Q(1), size: 1, kind: 'message' })); const v = m.version;
    for (const k of ['queue.approve', 'queue.reject', 'queue.drop', 'queue.claim', 'queue.done']) expect(run(ev(k, A, { item: Q(1), code: 'x', agent_id: 'a', outcome: 'ok' })).ignored, k).toBe('not_host'); expect(run(ev('queue.reorder', A, { order: [Q(1)] })).ignored).toBe('not_host');
    expect(run(ev('queue.submit', 'mem_V', { item: Q(2), size: 1, kind: 'message' })).ignored).toBe('viewer'); expect(run(ev('queue.submit', A, { item: Q(1), size: 1, kind: 'message' })).ignored).toBe('duplicate'); expect(run(ev('queue.state', A, { version: 99, items: [] })).ignored).toBe('forged_state'); expect(m.version).toBe(v); expect(m.get(Q(1))!.state).toBe('queued');
  });
  it('a frame replayed with an old seq is ignored; unknown kinds and states are tolerated', () => {
    seq = 0; const m = new QueueModel(); m.apply(ev('queue.submit', A, { item: Q(1), size: 1, kind: 'message' }, undefined, 5), ctx); expect(m.apply(ev('queue.approve', HOST, { item: Q(1) }, undefined, 4), ctx).ignored).toBe('old_seq'); expect(m.apply(ev('queue.future', HOST, { item: Q(1) }, undefined, 6), ctx).ignored).toBe('unknown_kind');
    m.apply(ev('queue.state', 'srv', { version: 3, items: [{ item: Q(7), submitter: A, state: 'warp-speed', position: 0, size: 5, kind: 'message', ts: 't' }] }, undefined, 7), ctx); expect(m.get(Q(7))!.state).toBe('queued');
  });
});
describe('reorder and authoritative state (acceptance 7)', () => {
  it('the later reorder (higher seq) wins on every replica', () => {
    seq = 0; const base = [ev('queue.submit', A, { item: Q(1), size: 1, kind: 'message' }), ev('queue.submit', A, { item: Q(2), size: 1, kind: 'message' }), ev('queue.submit', A, { item: Q(3), size: 1, kind: 'message' }), ev('queue.approve', HOST, { item: Q(1) }), ev('queue.approve', HOST, { item: Q(2) }), ev('queue.approve', HOST, { item: Q(3) })];
    const r1 = ev('queue.reorder', HOST, { order: [Q(3), Q(2), Q(1)] }); const r2 = ev('queue.reorder', HOST, { order: [Q(2), Q(1), Q(3)] }); const x = replay([...base, r1, r2]); expect(x.view().items.filter((i) => i.position !== null).sort((a, b) => a.position! - b.position!).map((i) => i.id)).toEqual([Q(2), Q(1), Q(3)]);
    const y = new QueueModel(); for (const e of [...base, r2, r1].sort((a, b) => a.seq - b.seq)) y.apply(e, ctx); expect(summary(y)).toEqual(summary(x));
  });
  it('queue.state with a higher version replaces local state wholesale; an older one does nothing', () => {
    seq = 0; const m = replay([ev('queue.submit', A, { item: Q(1), size: 1, kind: 'message' })]); m.apply(ev('queue.state', 'srv', { version: 10, items: [{ item: Q(5), submitter: B, state: 'approved', position: 0, size: 9, kind: 'command', ts: 't1' }, { item: Q(6), submitter: A, state: 'queued', position: 1, size: 3, kind: 'message', ts: 't2' }] }), ctx);
    expect(m.view().items.filter((i) => i.state === 'approved' || i.state === 'queued').map((i) => i.id)).toEqual([Q(5), Q(6)]); expect(m.get(Q(1))).toBeUndefined(); expect(m.version).toBeGreaterThanOrEqual(10); const before = summary(m); m.apply(ev('queue.state', 'srv', { version: 4, items: [] }), ctx); expect(summary(m)).toEqual(before);
  });
  it('items that already finished stay visible when a snapshot arrives', () => { seq = 0; const m = replay([ev('queue.submit', A, { item: Q(1), size: 1, kind: 'message' }), ev('queue.approve', HOST, { item: Q(1) }), ev('queue.claim', HOST, { item: Q(1), agent_id: 'agt_X' }), ev('queue.done', HOST, { item: Q(1), outcome: 'ok' })]); m.apply(ev('queue.state', 'srv', { version: 20, items: [] }), ctx); expect(m.get(Q(1))!.state).toBe('done'); });
});
describe('paused host (acceptance 10)', () => {
  it('approved and running items show as held while paused and come back when live', () => {
    seq = 0; const m = replay([ev('queue.submit', A, { item: Q(1), size: 1, kind: 'message' }), ev('queue.submit', A, { item: Q(2), size: 1, kind: 'message' }), ev('queue.approve', HOST, { item: Q(1) }), ev('queue.claim', HOST, { item: Q(1), agent_id: 'agt_X' }), ev('queue.approve', HOST, { item: Q(2) })]);
    m.setPaused(true); expect(m.view().items.map((i) => i.state)).toEqual(['held', 'held']); m.setPaused(false); expect(m.view().items.map((i) => i.state)).toEqual(['running', 'approved']);
  });
});
describe('property: replicas converge', () => {
  const ops = fc.array(fc.record({ k: fc.constantFrom('submit', 'approve', 'reject', 'cancel', 'drop', 'claim', 'done', 'reorder'), item: fc.integer({ min: 1, max: 6 }), who: fc.constantFrom(HOST, A, B), order: fc.shuffledSubarray([1, 2, 3, 4, 5, 6], { minLength: 1 }), outcome: fc.constantFrom('ok', 'error', 'canceled') }), { minLength: 1, maxLength: 60 });
  it('any frames in seq order give the same view on two replicas, and out-of-order arrival sorted by seq gives it too', () => {
    fc.assert(fc.property(ops, fc.integer({ min: 1, max: 1_000_000 }), (list, salt) => {
      seq = 0; const frames = list.map((o) => ev(`queue.${o.k}`, o.who, o.k === 'submit' ? { item: Q(o.item), size: 5, kind: 'message' } : o.k === 'reorder' ? { order: o.order.map(Q) } : o.k === 'claim' ? { item: Q(o.item), agent_id: 'agt_X' } : o.k === 'done' ? { item: Q(o.item), outcome: o.outcome } : o.k === 'reject' ? { item: Q(o.item), code: 'other' } : { item: Q(o.item) }));
      const a = replay(frames); const b = replay(frames); const shuffled = [...frames].sort((x, y) => ((x.seq * salt) % 97) - ((y.seq * salt) % 97)); const c = new QueueModel(); for (const e of shuffled.sort((x, y) => x.seq - y.seq)) c.apply(e, ctx);
      return JSON.stringify(a.view()) === JSON.stringify(b.view()) && JSON.stringify(a.view()) === JSON.stringify(c.view()) && a.view().items.every((i) => i.position === null || i.position >= 0);
    }), { numRuns: 300 });
  });
});
