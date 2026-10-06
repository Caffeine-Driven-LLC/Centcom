import { describe, expect, it } from 'vitest';
import { createBus } from '../../src/events/index.js';

type M = { a: { n: number }; b: { s: string } };
const mk = () => createBus<M>({ onError: () => undefined });
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('stream', () => {
  it('yields events as they arrive, across names, in order', async () => {
    const bus = mk(); const s = bus.stream(['a', 'b']); const got: unknown[] = []; const done = (async () => { for await (const e of s) { got.push(e); if (got.length === 3) break; } })();
    bus.emit('a', { n: 1 }); await tick(); bus.emit('b', { s: 'x' }); bus.emit('a', { n: 2 }); await done; expect(got).toEqual([{ k: 'a', p: { n: 1 } }, { k: 'b', p: { s: 'x' } }, { k: 'a', p: { n: 2 } }]); expect(bus.listenerCount()).toBe(0); // leaving the loop released it
  });
  it('events emitted before the first next() are not lost', async () => { const bus = mk(); const s = bus.stream(['a']); bus.emit('a', { n: 1 }); bus.emit('a', { n: 2 }); expect((await s.next()).value).toEqual({ k: 'a', p: { n: 1 } }); expect((await s.next()).value).toEqual({ k: 'a', p: { n: 2 } }); await s.return!(); });
  it('a stalled consumer with buffer 3 and drop-oldest sees the last 3 of 10, and memory stays bounded', async () => {
    const bus = mk(); const s = bus.stream(['a'], { buffer: 3 }); for (let i = 1; i <= 10; i++) bus.emit('a', { n: i });
    const got: number[] = []; for (let i = 0; i < 3; i++) got.push((await s.next()).value.p.n); expect(got).toEqual([8, 9, 10]); expect(s.dropped).toBe(7);
    bus.emit('a', { n: 11 }); expect((await s.next()).value.p.n).toBe(11); await s.return!();
  });
  it('drop-newest keeps the first ones', async () => { const bus = mk(); const s = bus.stream(['a'], { buffer: 3, overflow: 'drop-newest' }); for (let i = 1; i <= 10; i++) bus.emit('a', { n: i }); const got: number[] = []; for (let i = 0; i < 3; i++) got.push((await s.next()).value.p.n); expect(got).toEqual([1, 2, 3]); await s.return!(); });
  it('return() unsubscribes, ends a waiting reader, and later events are ignored', async () => {
    const bus = mk(); const s = bus.stream(['a', 'b']); expect(bus.listenerCount()).toBe(2); const waiting = s.next(); await s.return!(); expect((await waiting).done).toBe(true); expect(bus.listenerCount()).toBe(0);
    bus.emit('a', { n: 1 }); expect((await s.next()).done).toBe(true); await s.return!(); // idempotent
  });
  it('the same name twice does not double-deliver', async () => { const bus = mk(); const s = bus.stream(['a', 'a']); bus.emit('a', { n: 1 }); expect((await s.next()).value.p.n).toBe(1); bus.emit('a', { n: 2 }); expect((await s.next()).value.p.n).toBe(2); await s.return!(); });
  it('many streams, each bounded, do not interfere', async () => {
    const bus = mk(); const slow = bus.stream(['a'], { buffer: 2 }); const fast = bus.stream(['a'], { buffer: 100 }); const got: number[] = []; const r = (async () => { for await (const e of fast) { got.push(e.p.n); if (got.length === 50) break; } })();
    for (let i = 1; i <= 50; i++) { bus.emit('a', { n: i }); if (i % 5 === 0) await tick(); } await r; expect(got).toEqual(Array.from({ length: 50 }, (_x, i) => i + 1)); expect((await slow.next()).value.p.n).toBe(49); await slow.return!();
  });
});
