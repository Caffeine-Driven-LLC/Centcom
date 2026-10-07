import { describe, expect, it } from 'vitest';
import { PresenceClient } from '@centcom/net';
import { createCursorPublisher } from '../../src/cursors/index.js';
import { clock } from './helpers.js';

const fakeSession = () => { const sent: { kind: string; body: Record<string, unknown> }[] = []; const s = { me: { id: 'me' }, roster: () => [], onAny: () => () => undefined, sendEvent: async (kind: string, body: Record<string, unknown>) => { sent.push({ kind, body }); return { id: 'x', seq: 0 }; } }; return { s, sent }; };
describe('publishing (acceptance 1)', () => {
  it('at most 10 frames in any one second under a 1 000 events/s burst, and the last position within 100 ms of its end', () => {
    const c = clock(); const { s, sent } = fakeSession(); const pc = new PresenceClient(s as never, { clock: c, activity: { lastInputAt: () => 0, onInput: () => () => undefined } }); const pub = createCursorPublisher(pc, { clock: c });
    for (let i = 0; i < 3000; i++) { c.advance(1); pub.publish({ path: 'a.ts', line: i, col: 1 }); } const stamps: number[] = []; void stamps;
    c.advance(100); const frames = sent.filter((x) => x.kind === 'presence.cursor'); expect(frames.length).toBeLessThanOrEqual(31); expect(frames.length).toBeGreaterThan(20); expect((frames.at(-1)!.body.secret as { line: number }).line).toBe(2999);
    pub.dispose(); pc.dispose();
  });
  it('spacing: never two sends closer than 100 ms; unchanged positions send nothing', () => {
    const c = clock(); const calls: number[] = []; const pub = createCursorPublisher({ setCursor: () => { calls.push(c.now()); } }, { clock: c });
    for (let i = 0; i < 500; i++) { c.advance(3); pub.publish({ line: i }); } c.advance(200); for (let i = 1; i < calls.length; i++) expect(calls[i]! - calls[i - 1]!).toBeGreaterThanOrEqual(100);
    const n = calls.length; pub.publish({ line: 499 }); c.advance(500); expect(calls.length).toBe(n); expect(calls.at(-1)).toBeLessThanOrEqual(1500 + 100);
  });
  it('trailing edge: the last position goes out within 100 ms after the burst stops; maxHz lowers the rate', () => {
    const c = clock(); const calls: { line?: number; at: number }[] = []; const pub = createCursorPublisher({ setCursor: (p) => { calls.push({ line: p?.line, at: c.now() }); } }, { clock: c }); pub.publish({ line: 1 }); c.advance(10); pub.publish({ line: 2 }); c.advance(10); pub.publish({ line: 3 }); expect(calls.map((x) => x.line)).toEqual([1]); c.advance(79); expect(calls).toHaveLength(1); c.advance(1); expect(calls.map((x) => x.line)).toEqual([1, 3]);
    const slow = createCursorPublisher({ setCursor: (p) => { calls.push({ line: p?.line, at: c.now() }); } }, { clock: c, maxHz: 2 }); calls.length = 0; slow.publish({ line: 1 }); c.advance(200); slow.publish({ line: 2 }); c.advance(299); expect(calls).toHaveLength(1); c.advance(1); expect(calls).toHaveLength(2);
  });
  it('clear sends a null cursor; after dispose nothing is sent', () => {
    const c = clock(); const calls: unknown[] = []; const pub = createCursorPublisher({ setCursor: (p) => { calls.push(p); } }, { clock: c }); pub.publish({ line: 1 }); pub.clear(); expect(calls.at(-1)).toBeNull(); pub.dispose(); pub.publish({ line: 2 }); c.advance(500); expect(calls).toHaveLength(2);
  });
});
