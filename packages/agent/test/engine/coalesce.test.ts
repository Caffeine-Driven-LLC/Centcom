import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { VirtualClock } from '@centcom/testkit';
import { createCoalescer, type DeltaFrame } from '../../src/index.js';

const rig = () => { const clock = new VirtualClock(); const frames: (DeltaFrame & { at: number })[] = []; const c = createCoalescer({ clock, emit: (f) => frames.push({ ...f, at: clock.now() }) }); return { clock, frames, c }; };
const bytes = (s: string) => Buffer.byteLength(s);

describe('coalesceDeltas', () => {
  it('10 KiB in one millisecond: frames of at most 4096 bytes, at most 10 per second, lossless, an emoji on the 4096 boundary stays whole', async () => {
    const { clock, frames, c } = rig(); const text = 'a'.repeat(4094) + '😀' + 'b'.repeat(10240 - 4094 - 4); for (let i = 0; i < text.length; i += 100) c.push('m', text.slice(i, i + 100)); c.end('m'); await clock.advance(3000);
    expect(frames.map((f) => f.text).join('')).toBe(text); expect(frames.every((f) => bytes(f.text) <= 4096)).toBe(true); expect(frames.length).toBeLessThanOrEqual(10); expect(frames.length).toBeGreaterThanOrEqual(3); expect(frames[0]!.text.endsWith('😀')).toBe(false); expect(frames.some((f) => f.text.includes('😀'))).toBe(true); expect(frames.every((f) => !f.text.includes('�'))).toBe(true);
    expect(frames.map((f) => f.index)).toEqual(frames.map((_f, i) => i));
  });
  it('small deltas are held for the latency window and sent as one frame', async () => { const { clock, frames, c } = rig(); for (let i = 0; i < 20; i++) c.push('m', 'ab'); expect(frames).toHaveLength(0); await clock.advance(99); expect(frames).toHaveLength(0); await clock.advance(1); expect(frames.map((f) => f.text)).toEqual(['ab'.repeat(20)]); });
  it('end() flushes at once; different messages never share a frame', async () => { const { clock, frames, c } = rig(); c.push('a', 'one'); c.push('b', 'two'); c.end('b'); await clock.advance(10); expect(frames.map((f) => [f.message_id, f.text])).toEqual([['a', 'one'], ['b', 'two']]); });
  it('a flood is rate limited to 10 frames in any second and loses nothing', async () => {
    const { clock, frames, c } = rig(); const big = 'x'.repeat(4096); let total = ''; for (let i = 0; i < 40; i++) { c.push('m', big); total += big; } c.end('m'); await clock.advance(10_000);
    expect(frames.map((f) => f.text).join('')).toBe(total); for (let i = 10; i < frames.length; i++) expect(frames[i]!.at - frames[i - 10]!.at).toBeGreaterThanOrEqual(1000);
  });
  it('dispose cancels timers', async () => { const { clock, c } = rig(); c.push('m', 'x'); c.dispose(); expect(clock.pending()).toBe(0); });
  it('property: any text split any way, arriving at any times, is lossless, <= 4 KiB per frame, <= 10 per second', () => {
    fc.assert(fc.asyncProperty(fc.array(fc.record({ t: fc.fullUnicodeString({ maxLength: 3000 }), dt: fc.integer({ min: 0, max: 400 }) }), { minLength: 1, maxLength: 30 }), async (parts) => {
      const { clock, frames, c } = rig(); let all = ''; for (const p of parts) { c.push('m', p.t); all += p.t; await clock.advance(p.dt); } c.end('m'); await clock.advance(20_000);
      expect(frames.map((f) => f.text).join('')).toBe(all); for (const f of frames) { expect(bytes(f.text)).toBeLessThanOrEqual(4096); expect(f.text.includes('�') && !all.includes('�')).toBe(false); } for (let i = 10; i < frames.length; i++) expect(frames[i]!.at - frames[i - 10]!.at).toBeGreaterThanOrEqual(1000); expect(c.pending()).toBe(0);
    }), { numRuns: 80 });
  });
});
