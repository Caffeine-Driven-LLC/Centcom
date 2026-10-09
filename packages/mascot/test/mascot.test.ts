import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MascotDriver, SCENES, SCENE_FOR_STATE, bakedNames, centoPixels, getBaked, miniRows, recolorRows, renderHalfBlock, renderPlain, renderScene, textRows, type Clock } from '../src/index.js';

class FakeClock implements Clock {
  t = 0; private q: { at: number; fn: () => void; id: number }[] = []; private n = 0;
  now() { return this.t; }
  setTimeout(fn: () => void, ms: number) { const id = ++this.n; this.q.push({ at: this.t + ms, fn, id }); return id; }
  clearTimeout(h: unknown) { this.q = this.q.filter((x) => x.id !== h); }
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at);
      const next = this.q[0];
      if (!next || next.at > end) break;
      this.q.shift(); this.t = next.at; next.fn();
    }
    this.t = end;
  }
}

describe('sprite', () => {
  it('draws a 12x12 body with antenna, eyes and shadow pixels', () => {
    const p = centoPixels({ e: 'open', m: 'smile' });
    expect(p.get('0,5')).toBe('T');
    expect(p.get('6,3')).toBe('P');
    expect(p.get('9,0')).toBe('D');
    expect(p.get('3,1')).toBe('H');
    const rows = [...p.keys()].map((k) => Number(k.split(',')[0]));
    expect(Math.min(...rows)).toBe(0); expect(Math.max(...rows)).toBe(11);
  });
  it('recolours to another Cento colour without touching the face', () => {
    const p = centoPixels({ color: 'red' });
    expect(p.get('5,0')).toBe('4');
    expect(p.get('6,3')).toBe('P');
    expect(recolorRows(['BDHS.P'], 'green')).toEqual(['123' + '2.P']);
  });
  it('accessories and arms extend outside the body', () => {
    const p = centoPixels({ al: 'far', acc: ['headphones'] });
    expect(p.get('8,-3')).toBe('D');
    expect(p.has('4,-1')).toBe(true);
  });
});

describe('renderers', () => {
  it('uses upper-half blocks, two pixels per cell', () => {
    const [row] = renderHalfBlock(['B.', '.B'], 'truecolor');
    expect(row).toContain('▀'); expect(row).toContain('▄');
    expect(row).toContain('38;2;124;92;255');
    expect(renderHalfBlock(['BB', 'BB'], 'truecolor')[0]).toContain('█');
  });
  it('renders nothing but spaces for empty pixels and no escapes for tier none', () => {
    expect(renderHalfBlock(['..', '..'], 'truecolor')).toEqual(['  ']);
    expect(renderHalfBlock(['B.', '.B'], 'none')[0]).not.toContain('\x1b');
    expect(renderPlain(['BB', '..'])).toEqual(['▀▀']);
  });
  it('falls back to 256 and 16 colour codes', () => {
    expect(renderHalfBlock(['B', 'B'], '256')[0]).toMatch(/38;5;\d+/);
    expect(renderHalfBlock(['B', '.'], '16')[0]).toMatch(/\x1b\[(3\d|9\d)m/);
  });
  it('is stable: a 12x12 sprite is 6 terminal rows', () => {
    const r = renderScene('idle');
    expect(r.height).toBe(12); expect(renderHalfBlock(r.frames[0]!.rows, 'truecolor')).toHaveLength(6);
  });
  it('draws text and mini sprites', () => {
    expect(textRows('A', 'B')).toEqual(['.B.', 'B.B', 'BBB', 'B.B', 'B.B']);
    for (const s of ['idle', 'working', 'thinking', 'waiting', 'error', 'done', 'sleeping'] as const) {
      const m = miniRows(s, 'red'); expect(m).toHaveLength(8); expect(m.every((r) => r.length === 8)).toBe(true);
    }
  });
});

describe('scenes and state map', () => {
  it('renders every scene, all frames the same size', () => {
    for (const name of Object.keys(SCENES)) {
      const r = renderScene(name);
      expect(r.frames.length).toBeGreaterThan(0);
      for (const f of r.frames) { expect(f.rows).toHaveLength(r.height); expect(new Set(f.rows.map((x) => x.length)).size).toBe(1); }
      expect(r.height % 2).toBe(0);
    }
  });
  it('maps only to scenes that exist and covers the contract state names it claims', () => {
    for (const s of Object.values(SCENE_FOR_STATE)) expect(SCENES[s], s).toBeDefined();
    const contract = JSON.parse(readFileSync(new URL('../../../contracts/state-map.json', import.meta.url), 'utf8')) as Record<string, string>;
    const wire = ['idle', 'thinking', 'streaming', 'tool-running', 'awaiting-approval', 'error', 'success', 'editing-file', 'reading-file'];
    for (const s of wire) { expect(contract[s], s).toBeDefined(); expect(SCENE_FOR_STATE[s], s).toBeDefined(); }
  });
  it('ships the baked library', () => {
    expect(bakedNames().length).toBeGreaterThanOrEqual(319);
    expect(getBaked('dap_up')?.social).toBe(true);
  });
});

describe('MascotDriver', () => {
  it('plays frames on schedule and loops', () => {
    const c = new FakeClock(); const d = new MascotDriver({ clock: c }); const seen: number[] = [];
    d.subscribe((f) => seen.push(f.index)); d.start();
    c.advance(1700); expect(seen.at(-1)).toBe(1);
    c.advance(100); expect(seen.at(-1)).toBe(2);
  });
  it('holds a state for the minimum dwell, but urgent states cut in', () => {
    const c = new FakeClock(); const d = new MascotDriver({ clock: c, dwellMs: 600 }); d.start();
    d.setState('thinking'); c.advance(100);
    d.setState('streaming'); expect(d.frame.state).toBe('thinking');
    c.advance(600); expect(d.frame.state).toBe('streaming');
    d.setState('tool-running'); expect(d.frame.state).toBe('streaming');
    d.setState('error'); expect(d.frame.state).toBe('error');
  });
  it('plays one-shots once and returns to the state before them', () => {
    const c = new FakeClock(); const d = new MascotDriver({ clock: c, dwellMs: 0 }); d.start();
    d.setState('thinking'); c.advance(10);
    d.setState('approved'); expect(d.frame.state).toBe('approved');
    c.advance(5000); expect(d.frame.state).toBe('thinking');
  });
  it('is static under reduced motion and sleeps after long idleness', () => {
    const c = new FakeClock(); const d = new MascotDriver({ clock: c, reducedMotion: true }); const seen: number[] = [];
    d.subscribe((f) => seen.push(f.index)); d.start(); c.advance(60_000); expect(new Set(seen)).toEqual(new Set([0]));
    const d2 = new MascotDriver({ clock: c, sleepAfterMs: 1000 }); d2.start(); c.advance(1500);
    expect(d2.frame.scene).toBe('sleeping');
  });
  it('shows generic working for unknown states', () => {
    const d = new MascotDriver({ clock: new FakeClock(), dwellMs: 0 }); d.start(); d.setState('some-future-state');
    expect(d.frame.scene).toBe('thinking');
  });
});

describe('MascotDriver: pause and speed (idle cost)', () => {
  it('paused: no frames and no timers while nothing shows the mascot; resumed: it animates again', () => {
    const c = new FakeClock(); const d = new MascotDriver({ clock: c }); const seen: number[] = []; d.subscribe((f) => seen.push(f.index)); d.start();
    c.advance(1700); expect(seen.length).toBeGreaterThan(1); d.setPaused(true); const n = seen.length; c.advance(60_000); expect(seen.length).toBe(n); // a minute of nothing
    d.setState('thinking'); c.advance(60_000); expect(seen.length).toBeLessThanOrEqual(n + 1); // a change of state is shown once, but nothing runs on a timer
    d.setPaused(false); c.advance(5000); expect(seen.length).toBeGreaterThan(n + 1); d.setPaused(false);
  });
  it('slower: three times the time between frames, and back to normal on restore', () => {
    const c = new FakeClock(); const d = new MascotDriver({ clock: c }); const seen: number[] = []; d.subscribe((f) => seen.push(f.index)); d.start();
    c.advance(1700); expect(seen.at(-1)).toBe(1); d.setSpeed(3); const before = seen.length; c.advance(300); expect(seen.length).toBe(before); c.advance(6000); expect(seen.length).toBeGreaterThan(before);
    const slow = seen.length - before; const base = new MascotDriver({ clock: new FakeClock() }); void base; d.setSpeed(1); const m0 = seen.length; c.advance(6000); expect(seen.length - m0).toBeGreaterThan(slow); // faster again
    d.setSpeed(99); d.setSpeed(0); d.setSpeed(1); // out-of-range values are clamped, never break it
  });
});
