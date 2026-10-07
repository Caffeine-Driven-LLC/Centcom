import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import fc from 'fast-check';
import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { PaletteView, createFileIndex, createPaletteEngine, flatten, fuzzyScore, keepSelection, listProvider, move, paletteWidth, selected, type PaletteItem, type PaletteProvider, type Section } from '../../src/palette/index.js';

const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
function clock() { let t = 0; const timers: { at: number; f: () => void; id: number }[] = []; let n = 0; return { now: () => t, setTimeout: (f: () => void, ms: number) => { const id = ++n; timers.push({ at: t + ms, f, id }); return id; }, clearTimeout: (h: unknown) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1); }, async advance(ms: number) { const end = t + ms; for (;;) { await Promise.resolve(); timers.sort((a, b) => a.at - b.at); const x = timers[0]; if (!x || x.at > end) break; timers.shift(); t = x.at; x.f(); await new Promise((r) => setImmediate(r)); } t = end; await new Promise((r) => setImmediate(r)); } }; }
const item = (id: string, label: string): PaletteItem => ({ id, label, run: () => undefined });

describe('fuzzy', () => {
  it('cmp matches "command palette" better than "scope compare"; a non-subsequence is null', () => { const a = fuzzyScore('cmp', 'command palette')!; const b = fuzzyScore('cmp', 'scope compare')!; expect(a.score).toBeGreaterThan(b.score); expect(fuzzyScore('xyz', 'command palette')).toBeNull(); expect(fuzzyScore('ba', 'ab')).toBeNull(); });
  it.each([
    ['cp', 'command palette', [0, 8]], ['model', '/model', [1, 2, 3, 4, 5]], ['rs', 'resume session', [0, 7]], ['ab', 'a/b', [0, 2]], ['tx', 'src/test.txt', [9, 10]], ['', 'anything', []], ['A', 'xAx', [1]], ['a', 'xAx', [1]],
    ['usage', 'usage', [0, 1, 2, 3, 4]], ['fb', 'FooBar', [0, 3]], ['ok', 'ok', [0, 1]], ['ct', 'compact', [0, 6]], ['hlp', 'help', [0, 2, 3]],
  ])('%s in %s marks %j', (q, text, want) => { expect(fuzzyScore(q as string, text as string)?.indices).toEqual(want); });
  it('smart case: a capital makes it exact', () => { expect(fuzzyScore('A', 'abc')).toBeNull(); expect(fuzzyScore('a', 'ABC')).not.toBeNull(); });
  it('property: indices ascend, are in range, spell the query, and the score is deterministic', () => {
    fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 6 }), fc.string({ minLength: 0, maxLength: 30 }), (q, t) => { const a = fuzzyScore(q, t); const b = fuzzyScore(q, t); expect(a).toEqual(b); if (a) { expect([...a.indices].sort((x, y) => x - y)).toEqual(a.indices); expect(new Set(a.indices).size).toBe(a.indices.length); expect(a.indices.every((i) => i >= 0 && i < t.length)).toBe(true); const cs = /[A-Z]/.test(q); expect(a.indices.map((i) => (cs ? t[i] : t[i]!.toLowerCase())).join('')).toBe(cs ? q : q.toLowerCase()); } }), { numRuns: 300 });
  });
});

describe('engine', () => {
  const slow = (c: ReturnType<typeof clock>, ms: number, items: PaletteItem[]): PaletteProvider => ({ id: 'slow', group: 'Files', search: (_q, signal) => new Promise((res) => { c.setTimeout(() => res(signal.aborted ? [] : items), ms); }) });
  it('three keystrokes within the debounce are one query; a 4th aborts the previous one', async () => {
    const c = clock(); const calls: { q: string; signal: AbortSignal }[] = []; const p: PaletteProvider = { id: 'c', group: 'Commands', search: (q, signal) => { calls.push({ q, signal }); return new Promise((res) => { c.setTimeout(() => res([item('x', q)]), 500); }); } };
    const e = createPaletteEngine({ providers: [p], clock: c }); e.setQuery('c'); await c.advance(10); e.setQuery('co'); await c.advance(10); e.setQuery('com'); await c.advance(30); expect(calls.map((x) => x.q)).toEqual(['com']);
    e.setQuery('comm'); await c.advance(30); expect(calls.map((x) => x.q)).toEqual(['com', 'comm']); expect(calls[0]!.signal.aborted).toBe(true); expect(calls[1]!.signal.aborted).toBe(false);
  });
  it('a 2 s provider does not hold back the fast ones, and its late results leave the selection on the same item', async () => {
    const c = clock(); const fast: PaletteProvider = { id: 'f', group: 'Commands', search: async () => [item('a', 'alpha'), item('b', 'beta')] }; const e = createPaletteEngine({ providers: [fast, slow(c, 2000, [item('z', 'zeta.ts')])], clock: c });
    const seen: Section[][] = []; e.subscribe((s) => seen.push(s)); e.setQuery('a'); await c.advance(150); expect(e.sections().map((s) => s.group)).toEqual(['Commands']);
    const before = e.sections(); await c.advance(2000); const after = e.sections(); expect(after.map((s) => s.group)).toEqual(['Commands', 'Files']);
    expect(keepSelection({ query: 'a', sel: 1 }, before, after).sel).toBe(1); expect(selected(keepSelection({ query: 'a', sel: 1 }, before, after), after)!.id).toBe('b');
  });
  it('an empty query shows the recent commands, groups come in a fixed order and empty ones are left out', async () => {
    const c = clock(); const cmds = listProvider('cmd', 'Commands', () => [item('1', 'model'), item('2', 'resume'), item('3', 'help')], { recent: () => ['help', 'model'] }); const files: PaletteProvider = { id: 'f', group: 'Files', search: async () => [item('f1', 'a.ts')] };
    const e = createPaletteEngine({ providers: [files, cmds], clock: c }); e.setQuery(''); expect(e.sections()).toMatchObject([{ group: 'Commands', recent: true }]); expect(e.sections()[0]!.items.map((i) => i.label)).toEqual(['help', 'model']);
    e.setQuery('a'); await c.advance(40); expect(e.sections().map((s) => s.group)).toEqual(['Files']);
  });
});

describe('navigation', () => {
  const sec: Section[] = [{ group: 'Commands', items: [item('a', 'a'), item('b', 'b')] }, { group: 'Files', items: [item('c', 'c')] }];
  it('down at the last row wraps to the first; up at the first wraps to the last', () => { expect(move({ query: '', sel: 2 }, sec, 'down').sel).toBe(0); expect(move({ query: '', sel: 0 }, sec, 'up').sel).toBe(2); expect(move({ query: '', sel: 0 }, [], 'down').sel).toBe(0); expect(flatten(sec)).toHaveLength(3); });
});

describe('rendering', () => {
  const many = (n: number): Section[] => [{ group: 'Commands', items: Array.from({ length: n }, (_, i) => ({ ...item(`i${i}`, `command ${i}`), indices: [0] })) }];
  const r = (sections: Section[], cols: number, o: { sel?: number; query?: string } = {}) => strip(renderToString(<PaletteView query={o.query ?? 'co'} sections={sections} sel={o.sel ?? 0} cols={cols} />, { columns: cols })).split('\n').filter((l) => l.trim());
  it('is 60 columns wide at 80 and 120, and cols-4 at 50', () => { expect([paletteWidth(80), paletteWidth(120), paletteWidth(50)]).toEqual([60, 60, 46]); for (const [cols, w] of [[80, 60], [120, 60], [50, 46]] as const) { const lines = r(many(3), cols); expect(Math.max(...lines.map((l) => l.trim().length))).toBe(w); } });
  it('shows at most 8 results and a "▾ N more" row', () => { const lines = r(many(20), 80); expect(lines.filter((l) => /command \d+/.test(l))).toHaveLength(8); expect(lines.join('\n')).toContain('▾ 12 more'); const scrolled = r(many(20), 80, { sel: 15 }).join('\n'); expect(scrolled).toContain('command 15'); });
  it('no results: the exact copy; empty query with recent commands labels them Recent', () => {
    expect(r([], 80, { query: 'zzz' }).join(' ').replace(/[│╭╮╰╯─]/g, ' ').replace(/\s+/g, ' ')).toContain('Nothing matches "zzz". Try fewer words or check the spelling.');
    expect(r([{ group: 'Commands', recent: true, items: [item('h', 'help')] }], 80, { query: '' }).join('\n')).toContain('Recent'); expect(r(many(2), 80).join('\n')).toContain('↑↓ move · ⏎ run · esc close');
  });
});

describe('file index', () => {
  it('finds files by fuzzy name, skips ignored ones, and answers fast on 20,000 files', async () => {
    const files = Array.from({ length: 19_999 }, (_, i) => `src/dir${i % 200}/file${i}.ts`); files.push('docs/command-palette.md'); const idx = createFileIndex({ cwd: '/x', list: async () => files }); await idx.ready();
    const ac = new AbortController(); const times: number[] = []; for (let k = 0; k < 10; k++) { const t = performance.now(); await idx.search('cmdpal', ac.signal); times.push(performance.now() - t); }
    const top = await idx.search('cmdpal', ac.signal); expect(top[0]!.label).toBe('docs/command-palette.md'); times.sort((a, b) => a - b); expect(times[Math.floor(times.length * 0.95) - 1]!).toBeLessThan(250); /* generous in CI; the real number is far lower */ expect(idx.size()).toBe(20_000);
  });
  it('uses git ls-files (ignored files are left out) or falls back to a walk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-pal-')); execFileSync('git', ['init', '-q'], { cwd: dir }); writeFileSync(join(dir, '.gitignore'), 'secret.txt\n'); writeFileSync(join(dir, 'a.ts'), ''); writeFileSync(join(dir, 'secret.txt'), '');
    const idx = createFileIndex({ cwd: dir }); const labels = (await idx.search('t', new AbortController().signal)).map((i) => i.label); expect(labels).toContain('a.ts'); expect(labels).not.toContain('secret.txt');
    const plain = mkdtempSync(join(tmpdir(), 'cc-pal2-')); mkdirSync(join(plain, 'node_modules')); writeFileSync(join(plain, 'node_modules', 'x.js'), ''); writeFileSync(join(plain, 'ok.js'), ''); const w = createFileIndex({ cwd: plain, list: async () => { throw new Error('no git'); } });
    expect((await w.search('js', new AbortController().signal)).map((i) => i.label)).toEqual(['ok.js']);
  });
});
