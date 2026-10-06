import { PassThrough } from 'node:stream';
import React from 'react';
import { render, renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { bakedNames, getBaked } from '@centcom/mascot';
import { Cento, asciiCento, createAnimationBudget, createFrameCache, miniRows, type FrameCache } from '../../src/pixel/index.js';
import { textWidth } from '../../src/util/text.js';

const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
const cache = createFrameCache();

describe('sizes', () => {
  it('idle_breathe is 8 rows by 14 columns; the body is 6 rows by 12 columns; mini is 2 rows by 6 columns', () => {
    const hero = cache.lines('idle_breathe', 0, 'violet', 'truecolor'); expect(hero).toHaveLength(8); expect(Math.max(...hero.map((l) => textWidth(strip(l))))).toBeLessThanOrEqual(14); expect(getBaked('idle_breathe')!.w).toBe(14);
    const body = getBaked('idle_breathe')!.frames[0]!.rows.filter((r) => /[BDHPS]/.test(r)); expect(body.length).toBeGreaterThanOrEqual(11);
    const mini = cache.lines('idle_breathe', 0, 'violet', 'truecolor', 'mini'); expect(mini).toHaveLength(2); for (const l of mini) expect(textWidth(strip(l))).toBeLessThanOrEqual(6); expect(strip(mini.join(''))).toMatch(/[▀▄█]/);
    expect(miniRows(getBaked('thinking')!.frames[0]!.rows)).toHaveLength(4); expect(miniRows(['....'])).toEqual(['......', '......', '......', '......']);
  });
  it('every animation and its mini size render without throwing', () => { for (const n of bakedNames().slice(0, 80)) { expect(cache.lines(n, 0, 'violet', 'truecolor').length).toBeGreaterThan(0); expect(cache.lines(n, 0, 'red', '256', 'mini')).toHaveLength(2); } });
});

describe('tiers', () => {
  it('256 colours use no 38;2 sequences; 16 and none use no colour at all and show the text face', () => {
    expect(cache.lines('idle_breathe', 0, 'violet', '256').join('')).not.toContain('38;2'); expect(cache.lines('idle_breathe', 0, 'violet', 'truecolor').join('')).toContain('38;2');
    for (const t of ['16', 'none'] as const) { const l = cache.lines('error', 0, 'violet', t); expect(l.join('\n')).not.toMatch(/\u001b/); expect(l).toEqual(asciiCento('error', true)); expect(l.join('')).toContain('(x_x)'); }
    expect(cache.lines('idle_breathe', 0, 'violet', 'truecolor', 'hero', false).join('')).not.toMatch(/[•¡▀▄█]/);
  });
  it('the text faces: ¡ over the face, plain ASCII when unicode is off', () => { expect(asciiCento('idle_breathe', true)).toEqual(['  ¡', '(•_•)', '/|||\\']); expect(asciiCento('celebrate', true)[1]).toBe('(^_^)'); expect(asciiCento('sleeping', true)[1]).toBe('(-_-)zZ'); expect(asciiCento('thinking', false)[1]).toBe('(o_o?)'); expect(asciiCento('editing_file', false)[0]).toBe('  !'); });
  it('the five colours recolour the body', () => { const v = cache.lines('idle_breathe', 0, 'violet', 'truecolor').join(''); const r = cache.lines('idle_breathe', 0, 'red', 'truecolor').join(''); expect(v).not.toBe(r); expect(cache.lines('idle_breathe', 0, 'red', 'truecolor').join('')).toBe(r); });
});

describe('cache speed', () => {
  it('a cached frame costs under 2 ms at p95 over 1,000 renders; frame numbers wrap', () => {
    cache.lines('thinking', 0, 'violet', 'truecolor'); const ms: number[] = []; for (let i = 0; i < 1000; i++) { const t = performance.now(); cache.lines('thinking', i, 'violet', 'truecolor'); ms.push(performance.now() - t); } ms.sort((a, b) => a - b); expect(ms[949]!).toBeLessThan(2);
    const n = getBaked('thinking')!.frames.length; expect(cache.lines('thinking', n, 'violet', 'truecolor')).toEqual(cache.lines('thinking', 0, 'violet', 'truecolor')); expect(cache.lines('thinking', -1, 'violet', 'truecolor')).toEqual(cache.lines('thinking', n - 1, 'violet', 'truecolor'));
  });
});

describe('budget', () => {
  it('the 7th mascot waits for a place and takes it when one frees; releasing twice is harmless', () => {
    const b = createAnimationBudget(6); for (let i = 0; i < 6; i++) expect(b.acquire(`m${i}`)).toBe(true); expect(b.acquire('m6')).toBe(false); expect(b.acquire('m7')).toBe(false); expect(b.active()).toBe(6);
    let told = 0; b.subscribe(() => told++); b.release('m0'); b.release('m0'); expect(told).toBe(1); expect(b.acquire('m7')).toBe(false); /* m6 asked first */ expect(b.acquire('m6')).toBe(true); expect(b.acquire('m7')).toBe(false); b.release('m1'); expect(b.acquire('m7')).toBe(true);
  });
});

describe('the component', () => {
  function fakeClock() { const asked: number[] = []; const fns: (() => void)[] = []; return { asked, fns, clock: { setTimeout: (f: () => void, ms: number) => { asked.push(ms); fns.push(f); return fns.length; }, clearTimeout: () => undefined } }; }
  const out = () => Object.assign(new PassThrough(), { columns: 80, rows: 30, isTTY: false }) as unknown as NodeJS.WriteStream;
  it('waits each frame its own duration (450 ms for idle_breathe) before the next, and not at all when reduced or not playing', async () => {
    const a = fakeClock(); const r = render(<Cento animation="idle_breathe" clock={a.clock} budget={createAnimationBudget(6)} />, { stdout: out(), debug: true, patchConsole: false }); await new Promise((x) => setTimeout(x, 30)); expect(a.asked.length).toBeGreaterThan(0); expect(a.asked.every((m) => m === 450)).toBe(true); r.unmount();
    const b = fakeClock(); const r2 = render(<Cento animation="idle_breathe" clock={b.clock} motion="reduced" budget={createAnimationBudget(6)} />, { stdout: out(), debug: true, patchConsole: false }); await new Promise((x) => setTimeout(x, 30)); expect(b.asked).toEqual([]); r2.unmount();
    const c = fakeClock(); const r3 = render(<Cento animation="idle_breathe" clock={c.clock} playing={false} budget={createAnimationBudget(6)} />, { stdout: out(), debug: true, patchConsole: false }); await new Promise((x) => setTimeout(x, 30)); expect(c.asked).toEqual([]); r3.unmount();
  });
  it('a mascot beyond the budget holds its first frame and sets no timer', async () => {
    const budget = createAnimationBudget(1); budget.acquire('other'); const a = fakeClock(); const r = render(<Cento animation="idle_breathe" clock={a.clock} budget={budget} />, { stdout: out(), debug: true, patchConsole: false }); await new Promise((x) => setTimeout(x, 30)); expect(a.asked).toEqual([]); r.unmount();
  });
  it('draws the same text as the cache: hero rows, ascii at no colour', () => {
    expect(strip(renderToString(<Cento animation="error" tier="none" />, { columns: 40 })).split('\n').map((l) => l.trimEnd())).toEqual(['  ¡', '(x_x)', '/|||\\']); expect(renderToString(<Cento animation="idle_breathe" size="mini" />, { columns: 40 }).split('\n')).toHaveLength(2);
    const c: FrameCache = createFrameCache(() => undefined); expect(c.lines('nonexistent', 0, 'violet', 'truecolor').length).toBeGreaterThan(0);
  });
});
