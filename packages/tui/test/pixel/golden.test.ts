import { describe, expect, it } from 'vitest';
import { bakedNames } from '@centcom/mascot';
import { asciiCento, createFrameCache } from '../../src/pixel/index.js';

/** Golden output of the half-block renderer: how Cento is drawn must not change by accident. A change here is deliberate and shows up in review. */
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
const cache = createFrameCache();
/** One or two from each family of states people actually see. */
const ANIMATIONS = ['idle_breathe', 'idle_blink', 'typing', 'thinking', 'sleeping', 'error', 'celebrate', 'reading_file', 'editing_file'];

describe('Cento, drawn in half blocks (golden)', () => {
  it('every animation the golden files cover still exists (319 baked in all)', () => { for (const n of ANIMATIONS) expect(bakedNames()).toContain(n); expect(bakedNames().length).toBe(319); });
  it.each(ANIMATIONS)('%s: the shape of frames 0 and 1 (no colour), full size and mini', (name) => {
    for (const frame of [0, 1]) {
      expect(cache.lines(name, frame, 'violet', 'truecolor').map(strip)).toMatchSnapshot(`${name} frame ${frame} full`);
      expect(cache.lines(name, frame, 'violet', 'truecolor', 'mini').map(strip)).toMatchSnapshot(`${name} frame ${frame} mini`);
    }
  });
  it('colour: the same frame in each of the five colours and each colour tier keeps its escape codes (truecolor, 256, 16)', () => {
    const out: Record<string, string> = {};
    for (const c of ['violet', 'red', 'yellow', 'green', 'brown'] as const) for (const tier of ['truecolor', '256', '16'] as const) out[`${c}/${tier}`] = JSON.stringify(cache.lines('idle_breathe', 0, c, tier).join('\n'));
    expect(out).toMatchSnapshot('idle_breathe frame 0, five colours, three tiers');
  });
  it('no unicode: the ASCII fallback', () => { expect(ANIMATIONS.map((n) => asciiCento(n, false))).toMatchSnapshot('ascii fallback'); expect(ANIMATIONS.map((n) => asciiCento(n, true))).toMatchSnapshot('unicode fallback'); });
});
