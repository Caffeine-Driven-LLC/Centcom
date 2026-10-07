// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setMotion } from '../../src/a11y/index.js';
import { Mascot, SCALES, configureMascot, drawFrame } from '../../src/mascot/Mascot.js';
import { MascotScheduler } from '../../src/mascot/scheduler.js';
import { paletteFor } from '../../src/mascot/catalog.js';
import { all, fakeCatalog, idx, stubCanvas } from './helpers.js';

afterEach(() => { cleanup(); setMotion(undefined); });
const idle = all.animations.find((a) => a.name === 'idle_breathe')!; const sprite = { w: idle.w, h: idle.h, frames: idle.frames };
describe('pixels (acceptance 2)', () => {
  beforeEach(() => { stubCanvas().install(); });
  for (const scale of SCALES) for (const dpr of [1, 2]) it(`scale ${scale} at dpr ${dpr}: the canvas is a whole multiple of the 14x15 grid and every drawn square is a whole number of pixels`, () => {
    const s = stubCanvas(); s.install(); const cv = document.createElement('canvas'); drawFrame(cv, sprite, 0, scale, dpr, paletteFor(idx, 'violet')); const px = scale * dpr; expect(cv.width).toBe(14 * px); expect(cv.height).toBe(15 * px); expect(cv.width % 14).toBe(0); expect(cv.style.width).toBe(`${14 * scale}px`); expect(s.calls.length).toBeGreaterThan(20); for (const c of s.calls) { expect(Number.isInteger(c.x) && Number.isInteger(c.y)).toBe(true); expect(c.w).toBe(px); expect(c.h).toBe(px); expect(c.x % px).toBe(0); expect(c.y % px).toBe(0); }
  });
  it('golden: frame 0 of idle_breathe in each of the five colours draws the same squares in different body colours', () => { const sets: string[] = []; const fills: string[] = []; for (const colour of ['violet', 'red', 'yellow', 'green', 'brown']) { const s = stubCanvas(); s.install(); drawFrame(document.createElement('canvas'), sprite, 0, 2, 1, paletteFor(idx, colour)); sets.push(JSON.stringify(s.calls.map((c) => [c.x, c.y]))); fills.push(s.calls.find((c) => c.x === 3 * 2 && c.y === 3 * 2)!.fill); } expect(new Set(sets).size).toBe(1); expect(new Set(fills).size).toBe(5); expect(sprite.frames[0]!.rows).toHaveLength(15); });
});
describe('the component (acceptance 5, 7, 8)', () => {
  beforeEach(() => { stubCanvas().install(); configureMascot({ catalog: fakeCatalog(), scheduler: new MascotScheduler() }); });
  it('the canvas is hidden from assistive tech, there is no text, and the state is only an attribute', () => { const { container } = render(<Mascot state="idle" />); const cv = container.querySelector('canvas')!; expect(cv.getAttribute('aria-hidden')).toBe('true'); expect(container.textContent).toBe(''); expect(cv.getAttribute('data-mascot-state')).toBe('idle'); });
  it('reduced motion draws a still first frame and starts no timers; the startling states do not even draw', async () => { setMotion('reduced'); const s = stubCanvas(); s.install(); render(<Mascot state="idle" />); await new Promise((r) => setTimeout(r, 30)); const drawn = s.calls.length; expect(drawn).toBeGreaterThan(20); await new Promise((r) => setTimeout(r, 700)); expect(s.calls.length).toBe(drawn); cleanup(); const t = stubCanvas(); t.install(); render(<Mascot state="crash" />); await new Promise((r) => setTimeout(r, 30)); expect(t.calls.length).toBe(0); });
  it('with motion on the frames advance by their own durations, and a frozen mascot (7th) stays on frame 0', async () => { const s = stubCanvas(); s.install(); render(<Mascot state="idle" />); await new Promise((r) => setTimeout(r, 30)); const first = s.calls.length; await new Promise((r) => setTimeout(r, 600)); expect(s.calls.length).toBeGreaterThan(first); cleanup(); configureMascot({ scheduler: new MascotScheduler(0) }); const f = stubCanvas(); f.install(); render(<Mascot state="idle" />); await new Promise((r) => setTimeout(r, 30)); const still = f.calls.length; await new Promise((r) => setTimeout(r, 600)); expect(f.calls.length).toBe(still); });
  it('a hidden tab draws nothing for a second', async () => { const sch = new MascotScheduler(); configureMascot({ scheduler: sch }); const s = stubCanvas(); s.install(); render(<Mascot state="idle" />); await new Promise((r) => setTimeout(r, 30)); sch.setPageHidden(true); const n = s.calls.length; await new Promise((r) => setTimeout(r, 1000)); expect(s.calls.length).toBe(n); });
  it('an unknown state tells the caller and still shows something', async () => { let unknown = 0; const s = stubCanvas(); s.install(); render(<Mascot state="state-from-the-future" onUnknown={() => unknown++} />); await new Promise((r) => setTimeout(r, 40)); expect(unknown).toBe(1); expect(s.calls.length).toBeGreaterThan(20); });
});
