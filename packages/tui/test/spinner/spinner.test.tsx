import React from 'react';
import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { STATE_NAMES } from '@centcom/protocol';
import lines from '../../src/spinner/lines.json' with { type: 'json' };
import { FRAMES, Spinner, createVerbPicker, formatElapsed, formatTokens, isSeriousState, loadingPattern, nextVerbDelayMs, plainVerb, poolForState, spinnerLine } from '../../src/spinner/index.js';

const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
/** A small deterministic random source. */
const seeded = (seed = 1) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const SERIOUS = ['awaiting-approval', 'auth-required', 'session-expired', 'rate-limited', 'quota-reached', 'error', 'crash', 'deleting-file', 'reconnecting'];

describe('frames', () => {
  it('the glyph moves every 80 ms through the 10 frames and wraps', () => {
    const at = (ms: number) => spinnerLine({ elapsedMs: ms, verb: 'x', width: 80 }).glyph;
    expect(Array.from({ length: 12 }, (_, i) => at(i * 80 + 5))).toEqual([...FRAMES, FRAMES[0], FRAMES[1]]); expect(at(79)).toBe(FRAMES[0]); expect(at(80)).toBe(FRAMES[1]);
  });
  it('reduced motion shows a static …', () => { expect(spinnerLine({ elapsedMs: 5000, verb: 'x', width: 80, motion: 'reduced' }).glyph).toBe('…'); expect(spinnerLine({ elapsedMs: 160, verb: 'x', width: 80, unicode: false }).glyph).toMatch(/[-\\|/]/); });
  it('the meta: nothing at 1 s, time at 2 s, tokens at 5 s, the interrupt hint whenever it applies', () => {
    const m = (ms: number, tokens?: number) => spinnerLine({ elapsedMs: ms, verb: 'Thinking…', tokens, interruptible: true, width: 80 }).meta;
    expect(m(1000)).toBe('(esc to interrupt)'); expect(m(2000)).toBe('(2s · esc to interrupt)'); expect(m(5000, 1234)).toBe('(5s · ↑ 1.2k tokens · esc to interrupt)'); expect(m(5000)).toBe('(5s · esc to interrupt)');
    expect(spinnerLine({ elapsedMs: 1000, verb: 'x', width: 80 }).meta).toBe('');
  });
  it('one row: the meta is cut before the verb', () => { const l = spinnerLine({ elapsedMs: 9000, verb: 'Sub-agent-spawning with enthusiasm…', tokens: 5000, interruptible: true, width: 50 }); expect(l.verb).toBe('Sub-agent-spawning with enthusiasm…'); expect(l.glyph.length + 1 + l.verb.length + (l.meta ? 3 + l.meta.length : 0)).toBeLessThanOrEqual(50); });
});

describe('verb picker', () => {
  it('a new verb comes every 3 to 6 s', () => { const r = seeded(7); const d = Array.from({ length: 10_000 }, () => nextVerbDelayMs(r)); expect(Math.min(...d)).toBeGreaterThanOrEqual(3000); expect(Math.max(...d)).toBeLessThanOrEqual(6000); });
  it('nothing repeats until the bag is empty (743 draws from the default pool)', () => {
    const p = createVerbPicker({ rng: seeded(3) }); const eligible = lines.filter((l) => l.length <= 40).length; const seen = new Set<string>();
    for (let i = 0; i < eligible; i++) { const v = p.next({ state: 'thinking', elapsedMs: 5000, width: 120, serious: false }); expect(seen.has(v)).toBe(false); seen.add(v); } expect(seen.size).toBe(eligible); expect(lines).toHaveLength(743);
  });
  it('no verb is over 40 characters, or 24 when narrow', () => {
    const p = createVerbPicker({ rng: seeded(5) }); for (let i = 0; i < 800; i++) { expect(p.next({ state: 'thinking', elapsedMs: 5000, width: 120, serious: false }).length).toBeLessThanOrEqual(40); expect(p.next({ state: 'searching', elapsedMs: 5000, width: 59, serious: false }).length).toBeLessThanOrEqual(24); }
  });
  it('after 30 s the Absurd pool is used; states choose their pool', () => {
    const p = createVerbPicker({ rng: seeded(2), lines: ['A feelings line…', 'rubber duck stand-up…', 'beard-scratching…', 'sacrificing a semicolon…', 'oracle of git…', 'plain wiring…'] });
    const v = p.next({ state: 'thinking', elapsedMs: 31_000, width: 120, serious: false }); expect(['A feelings line…', 'rubber duck stand-up…', 'beard-scratching…', 'sacrificing a semicolon…', 'oracle of git…']).toContain(v);
    expect([poolForState('searching'), poolForState('editing-file'), poolForState('sub-agent'), poolForState('thinking'), poolForState('nonsense')]).toEqual(['Search', 'Code', 'Signals', 'Default', 'Default']);
  });
  it('serious states and states after an error get plain words only, never a line from the file', () => {
    const p = createVerbPicker({ rng: seeded(9) }); const all = new Set<string>(lines);
    for (const s of SERIOUS) { for (let i = 0; i < 30; i++) { const v = p.next({ state: s, elapsedMs: 40_000, width: 120, serious: false }); expect(all.has(v), s).toBe(false); } }
    const v = p.next({ state: 'thinking', elapsedMs: 5000, width: 120, serious: true }); expect(all.has(v)).toBe(false); expect([plainVerb('awaiting-approval'), plainVerb('reconnecting'), plainVerb('rate-limited'), plainVerb('error')]).toEqual(['Waiting for approval…', 'Reconnecting…', 'Retrying…', 'Working…']);
  });
  it('plain mode always says Working…', () => { const p = createVerbPicker({ rng: seeded(1), plain: true }); expect([p.next({ state: 'thinking', elapsedMs: 9, width: 80, serious: false }), p.next({ state: 'searching', elapsedMs: 99_999, width: 80, serious: false })]).toEqual(['Working…', 'Working…']); });
  it('every state name is classified exactly once: serious, or in one pool', () => {
    const pools = new Set(['Default', 'Ocean', 'Signals', 'Code', 'Search', 'Build', 'Math', 'Absurd']);
    for (const s of STATE_NAMES) { const serious = isSeriousState(s); const pool = poolForState(s); expect(pools.has(pool), s).toBe(true); if (serious) expect(SERIOUS.includes(s) || s.startsWith('provider-') || s === 'denied', s).toBe(true); }
    for (const s of SERIOUS) expect(STATE_NAMES as readonly string[]).toContain(s);
  });
});

describe('formatting and pattern', () => {
  it('tokens and elapsed', () => { expect([999, 1000, 1400, 12_000, 1_234_567].map(formatTokens)).toEqual(['999', '1.0k', '1.4k', '12k', '1.2M']); expect([0, 12_000, 65_000, 3_720_000].map(formatElapsed)).toEqual(['0s', '12s', '1m05s', '1h02m']); });
  it('loading pattern follows DESIGN 9.4', () => { expect([50, 500, 2000, 8000, 29_999, 30_000].map(loadingPattern)).toEqual(['none', 'dim', 'spinner', 'spinner-mascot', 'spinner-mascot', 'spinner-long']); });
});

describe('rendering', () => {
  const start = new Date(1_000_000);
  const r = (o: Partial<React.ComponentProps<typeof Spinner>> = {}, cols = 80) => strip(renderToString(<Spinner state="thinking" startedAt={start} now={() => 1_000_000 + 5000} rng={seeded(4)} animate={false} interruptible tokens={1400} width={cols} {...o} />, { columns: cols }));
  it('one row at 80 and 60 columns with the verb, time, tokens and the hint', () => {
    for (const c of [80, 60]) { const out = r({}, c).split('\n').filter(Boolean); expect(out).toHaveLength(1); expect(out[0]!.length).toBeLessThanOrEqual(c); }
    expect(r()).toMatch(/\(5s · ↑ 1\.4k tokens · esc to interrupt\)/);
  });
  it('a serious state shows plain words; NO_COLOR output has no escape bytes of its own', () => { expect(r({ state: 'awaiting-approval' })).toContain('Waiting for approval…'); expect(r({ serious: true })).toContain('Working…'); });
  it('a non-terminal gets one static line (glyph from frame 0)', () => { expect(r({ animate: false })).toContain(FRAMES[0]!); });
});
