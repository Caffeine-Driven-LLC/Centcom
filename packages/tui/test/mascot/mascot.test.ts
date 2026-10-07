import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMascotDriver, priorityOf, type DriverDeps, type MascotView } from '../../src/mascot/index.js';

const stateMap: Record<string, string> = JSON.parse(readFileSync(new URL('../../../../contracts/state-map.json', import.meta.url), 'utf8'));
const raw = JSON.parse(readFileSync(new URL('../../../mascot/data/animations.json', import.meta.url), 'utf8')).animations; const animations: string[] = Array.isArray(raw) ? raw.map((x: { name: string }) => x.name) : Object.keys(raw);
function clock(start = Date.UTC(2026, 9, 6, 12)) { let t = start; const timers: { at: number; f: () => void; id: number }[] = []; let n = 0; return { now: () => t, setTimeout: (f: () => void, ms: number) => { const id = ++n; timers.push({ at: t + ms, f, id }); return id; }, clearTimeout: (h: unknown) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1); }, advance(ms: number) { const end = t + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const x = timers[0]; if (!x || x.at > end) break; timers.shift(); t = x.at; x.f(); } t = end; } }; }
function rig(o: Partial<DriverDeps> & { cols?: number; rows?: number; env?: 'on' | 'off' | 'auto'; mascot?: 'on' | 'off'; motion?: 'full' | 'reduced'; hour?: number } = {}) {
  const c = clock(); const logs: string[] = []; const seen: string[] = [];
  const d = createMascotDriver({ clock: c, stateMap, tz: () => ({ hour: o.hour ?? 12 }), caps: () => ({ cols: o.cols ?? 100, rows: o.rows ?? 40, mascotEnv: o.env ?? 'auto' }), settings: () => ({ mascot: o.mascot ?? 'on', color: 'violet', motion: o.motion ?? 'full' }), log: { debug: (m) => logs.push(m) }, ...o });
  d.subscribe((_id, v) => seen.push(v.animation)); d.view('a'); const st = (state: string, agentId = 'a') => d.input({ type: 'state', agentId, state }); return { c, d, logs, seen, st, an: (id = 'a') => d.view(id).animation };
}

describe('state map', () => {
  it('every one of the 64 states resolves to an animation that exists, and each has one priority tier', () => {
    const r = rig(); for (const [s, a] of Object.entries(stateMap)) { expect(animations, s).toContain(a); expect([1, 2, 3, 4, 5, 6, 7, 8]).toContain(priorityOf(s)); }
    r.st('future-state'); r.c.advance(700); expect(r.an()).toBe('thinking'); expect(r.logs).toEqual(['mascot.unknown_state']); r.st('future-state'); expect(r.logs).toHaveLength(1);
    expect([priorityOf('crash'), priorityOf('awaiting-approval'), priorityOf('rate-limited'), priorityOf('editing-file'), priorityOf('ci-pass'), priorityOf('compacting'), priorityOf('host-session'), priorityOf('sleeping')]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('dwell and bursts', () => {
  it('thinking, then reading-file 400 ms later keeps thinking until 600 ms have passed', () => {
    const r = rig(); r.st('thinking'); r.c.advance(200); expect(r.an()).toBe('thinking'); r.c.advance(400); r.st('reading-file'); expect(r.an()).toBe('thinking'); r.c.advance(199); expect(r.an()).toBe('thinking'); r.c.advance(2); expect(r.an()).toBe('reading_file');
  });
  it('reading ten files in 3 s is a single reading_file view', () => { const r = rig(); r.st('thinking'); r.c.advance(1000); const before = r.seen.length; for (let i = 0; i < 10; i++) { r.st('reading-file'); r.c.advance(300); } expect(new Set(r.seen.slice(before)).size).toBeLessThanOrEqual(2); expect(r.an()).toBe('reading_file'); });
  it('5 tool calls in 2 s collapse into one tool_running; 3 do not', () => {
    const a = rig(); a.st('thinking'); a.c.advance(1000); for (let i = 0; i < 5; i++) { a.d.input({ type: 'tool-call', agentId: 'a' }); a.c.advance(300); } expect(a.an()).toBe('tool_running'); expect(a.seen.filter((x) => x === 'tool_running')).toHaveLength(1);
    const b = rig(); b.st('thinking'); b.c.advance(1000); for (let i = 0; i < 3; i++) { b.d.input({ type: 'tool-call', agentId: 'a' }); b.c.advance(300); } expect(b.an()).toBe('thinking'); a.c.advance(3000); expect(a.an()).not.toBe('tool_running');
  });
  it('entering work from idle plays one 200 ms acknowledgement first', () => { const r = rig(); r.c.advance(5000); r.st('editing-file'); expect(r.an()).toBe('prompt_received'); r.c.advance(201); expect(r.an()).toBe('editing_file'); });
});

describe('priority', () => {
  it('error beats editing-file (tier 1 over 4) and editing-file is listed as a chip', () => { const r = rig(); r.st('editing-file'); r.c.advance(1000); r.st('error'); r.c.advance(1000); expect(r.an()).toBe(stateMap.error); expect(r.d.chips('a')).toEqual(['editing-file']); });
  it('agents are independent', () => { const r = rig(); r.st('thinking', 'a'); r.st('searching', 'b'); r.c.advance(1000); expect([r.an('a'), r.an('b')]).toEqual(['thinking', 'searching']); });
});

describe('one-shots', () => {
  it('a failure plays error once; a retry does not replay it; a second failure is worried; then it settles back', () => {
    const r = rig(); r.st('thinking'); r.c.advance(1000); r.d.input({ type: 'failure', agentId: 'a' }); expect(r.d.view('a')).toMatchObject({ animation: 'error', loop: false }); const n = r.seen.filter((x) => x === 'error').length; r.d.input({ type: 'failure', agentId: 'a', retry: true }); expect(r.seen.filter((x) => x === 'error').length).toBe(n);
    r.c.advance(1600); expect(r.an()).toBe('thinking'); r.d.input({ type: 'failure', agentId: 'a' }); expect(r.an()).toBe('worried');
  });
  it('celebrate only for a milestone and once per 10 minutes, otherwise thumbs_up', () => {
    const r = rig(); r.d.input({ type: 'milestone', agentId: 'a', kind: 'pr-merged' }); expect(r.an()).toBe('celebrate'); r.c.advance(2000); r.d.input({ type: 'milestone', agentId: 'a', kind: 'release' }); expect(r.an()).toBe('thumbs_up'); r.c.advance(10 * 60_000); r.d.input({ type: 'milestone', agentId: 'a', kind: 'release' }); expect(r.an()).toBe('celebrate');
    const s = rig(); s.st('success'); expect(s.an()).toBe('thumbs_up'); s.c.advance(2000); expect(s.an()).not.toBe('thumbs_up'); s.st('celebrate'); expect(s.an()).toBe('thumbs_up'); /* a state alone is never a celebration */
  });
});

describe('idle and night', () => {
  it('breathes, blinks at 20 s, looks around at 3 min, is away at 10 min', () => {
    const r = rig(); expect(r.an()).toBe('idle_breathe'); r.c.advance(20_000); expect(r.an()).toBe('idle_blink'); r.c.advance(160_000); expect(r.an()).toBe('look_around'); r.c.advance(420_000); expect(r.an()).toBe('status_away'); r.d.input({ type: 'activity', agentId: 'a' }); r.c.advance(700); expect(r.an()).toBe('idle_breathe'); /* after the minimum dwell */
  });
  it('after 30 minutes without activity at 23:30 it sleeps; by day it does not', () => { const n = rig({ hour: 23 }); n.c.advance(31 * 60_000); expect(n.d.view('a')).toMatchObject({ animation: 'sleeping', reason: 'night' }); const d = rig({ hour: 14 }); d.c.advance(31 * 60_000); expect(d.an()).toBe('status_away'); const e = rig({ hour: 3 }); e.c.advance(29 * 60_000); expect(e.an()).toBe('status_away'); });
});

describe('visibility', () => {
  it('hidden by default; shown after an 8 s wait on a big enough terminal; first-run and empty screens show it', () => {
    const r = rig(); r.st('thinking'); r.c.advance(7000); expect(r.d.view('a').visible).toBe(false); r.c.advance(1500); expect(r.d.view('a').visible).toBe(true);
    const f = rig(); f.st('first-run'); expect(f.d.view('a').visible).toBe(true); f.st('empty'); expect(f.d.view('a').visible).toBe(true);
  });
  it('never at 80x24, with CENTO_MASCOT=off, with the setting off, while suppressed, or at a permission prompt', () => {
    const wait = (o: Parameters<typeof rig>[0]) => { const r = rig(o); r.st('thinking'); r.c.advance(9000); return r; };
    expect(wait({ cols: 80, rows: 24 }).d.view('a').visible).toBe(false); expect(wait({ env: 'off' }).d.view('a')).toMatchObject({ visible: false, reason: 'off' }); expect(wait({ mascot: 'off' }).d.view('a').visible).toBe(false);
    const s = wait({}); expect(s.d.view('a').visible).toBe(true); s.d.setSuppressed('permission', true); expect(s.d.view('a')).toMatchObject({ visible: false, reason: 'suppressed' }); s.d.setSuppressed('permission', false); expect(s.d.view('a').visible).toBe(true);
    const f = rig(); f.d.show('a', true); expect(f.d.view('a').visible).toBe(true); expect(wait({ cols: 100, rows: 30 }).d.view('a').visible).toBe(true);
  });
  it('success and failure moments are shown', () => { const r = rig(); r.d.input({ type: 'failure', agentId: 'a' }); expect(r.d.view('a').visible).toBe(true); r.c.advance(2000); expect(r.d.view('a').visible).toBe(false); });
});

describe('reduced motion', () => {
  it('crash, glitch and panic are replaced by a single error', () => { const r = rig({ motion: 'reduced', stateMap: { ...stateMap, crash: 'crash', odd: 'glitch', worry: 'panic' } }); for (const s of ['crash', 'odd', 'worry']) { r.st(s); r.c.advance(1000); expect(r.d.view('a')).toMatchObject({ animation: 'error', loop: false }); } const full = rig({ stateMap: { ...stateMap, crash: 'crash' } }); full.st('crash'); expect(full.an()).toBe('crash'); });
  it('exposes nothing that changes agent state', () => { const r = rig(); expect(Object.keys(r.d).sort()).toEqual(['chips', 'input', 'setSuppressed', 'show', 'subscribe', 'view']); });
});
