import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PINNED_16, PINNED_256, createTheme, memberColor, toXterm256, type ColourTier, type ThemeMode, type Token } from '../../src/theme/index.js';

const caps = (tier: ColourTier, unicode = true) => ({ tier, unicode });
const T13: Token[] = ['bg.base', 'bg.surface', 'border.default', 'text.primary', 'text.secondary', 'text.muted', 'accent.primary', 'accent.fill', 'signal', 'status.success', 'status.warning', 'status.danger', 'status.info'];
const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

describe('tiers', () => {
  it('the 13 design tokens are pinned for 256 colours and ANSI-16 (signal 86, bg.base 233, signal cyan, danger red)', () => {
    for (const t of T13) { expect(PINNED_256[t], t).toBeDefined(); expect(PINNED_16[t], t).toBeDefined(); }
    expect([PINNED_256.signal, PINNED_256['bg.base'], PINNED_256['status.danger'], PINNED_256['accent.primary']]).toEqual([86, 233, 203, 99]); expect([PINNED_16.signal, PINNED_16['status.danger'], PINNED_16['accent.primary']]).toEqual(['cyan', 'red', 'magenta']);
    const t256 = createTheme({ caps: caps('256'), mode: 'dark' }); expect(t256.paint('signal', 'x')).toBe('\u001b[38;5;86mx\u001b[0m'); expect(t256.paint('bg.base', 'x')).toBe('\u001b[48;5;233mx\u001b[0m'); expect(t256.style('status.info')).toEqual({ color: 'ansi256(75)' });
    const t16 = createTheme({ caps: caps('16'), mode: 'dark' }); expect(t16.paint('signal', 'x')).toBe('\u001b[36mx\u001b[0m'); expect(t16.paint('status.danger', 'x')).toBe('\u001b[31mx\u001b[0m'); expect(t16.style('status.success')).toEqual({ color: 'green' });
  });
  it('toXterm256 finds the nearest index: #7C5CFF is 99, and the search is deterministic over 1,000 colours', () => {
    expect(toXterm256('#7C5CFF')).toBe(99); expect(toXterm256('#000000')).toBe(16); expect(toXterm256('#ffffff')).toBe(231);
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 3, maxLength: 3 }), ([r, g, b]) => { const h = '#' + [r, g, b].map((v) => v!.toString(16).padStart(2, '0')).join(''); const a = toXterm256(h); expect(a).toBe(toXterm256(h)); expect(a).toBeGreaterThanOrEqual(16); expect(a).toBeLessThanOrEqual(255); }), { numRuns: 1000 });
  });
  it('truecolor uses the token hex; status colours use ANSI names unless statusColors is hex', () => {
    const ansi = createTheme({ caps: caps('truecolor'), mode: 'dark' }); expect([ansi.paint('status.success', 'x'), ansi.paint('status.danger', 'x'), ansi.paint('status.warning', 'x'), ansi.paint('signal', 'x'), ansi.paint('status.info', 'x')].map((s) => /\u001b\[(\d+)m/.exec(s)![1])).toEqual(['32', '31', '33', '36', '34']);
    expect(ansi.paint('accent.primary', 'x')).toBe('\u001b[38;2;124;92;255mx\u001b[0m'); const hexed = createTheme({ caps: caps('truecolor'), mode: 'dark', statusColors: 'hex' }); expect(hexed.paint('status.danger', 'x')).toMatch(/^\u001b\[38;2;255;92;92m/);
  });
});

describe('no colour', () => {
  it('no colour sequences at all, emphasis only; every status is a glyph and a word', () => {
    const t = createTheme({ caps: caps('none'), mode: 'dark' }); for (const tok of T13) expect(t.paint(tok, 'x', { bold: true })).not.toMatch(/\u001b\[[0-9;]*(3\d|4\d|9\d|38|48)/); expect(t.paint('text.muted', 'x')).toBe('\u001b[2mx\u001b[0m'); expect(t.paint('text.primary', 'x', { inverse: true })).toBe('\u001b[7mx\u001b[0m'); expect(t.style('signal')).toEqual({});
    expect([t.status('danger', 'error'), t.status('success', 'done'), t.status('warning', 'careful'), t.status('info', 'note')]).toEqual(['✗ error', '✓ done', '! careful', 'i note']); expect(createTheme({ caps: caps('none', false), mode: 'dark' }).status('danger', 'error')).toBe('x error'); expect(createTheme({ caps: caps('none', false), mode: 'dark' }).glyph('pointer')).toBe('>');
  });
});

describe('modes', () => {
  it('light uses the shallows values from the token file; hc is black, white and white borders', () => {
    const light = createTheme({ caps: caps('truecolor'), mode: 'light' }); const dark = createTheme({ caps: caps('truecolor'), mode: 'dark' }); expect(light.hex('text.primary')).toBe('#101012'); expect(light.hex('bg.base')).toBe('#F6F6F7'); expect(dark.hex('bg.base')).toBe('#0A0A0C'); expect(light.hex('status.danger')).toBe('#C21B1B');
    const hc = createTheme({ caps: caps('truecolor'), mode: 'hc' }); expect([hc.hex('bg.base'), hc.hex('text.primary'), hc.hex('border.default')]).toEqual(['#000000', '#FFFFFF', '#FFFFFF']); expect(hc.paint('status.danger', 'x')).toMatch(/38;2;255;92;92/); /* hc keeps real colours so it is not ANSI-named */
  });
  it('setMode notifies once and the next paint uses the new colours; the same mode notifies nobody; auto follows the background and falls back to dark', () => {
    const t = createTheme({ caps: caps('truecolor'), mode: 'dark' }); let n = 0; const off = t.subscribe(() => n++); const before = t.paint('accent.primary', 'x'); t.setMode('light'); expect(n).toBe(1); expect(t.mode).toBe('light'); expect(t.paint('accent.primary', 'x')).not.toBe(before); t.setMode('light'); expect(n).toBe(1); off(); t.setMode('dark'); expect(n).toBe(1);
    expect(createTheme({ caps: caps('truecolor'), mode: 'auto', background: 'light' }).mode).toBe('light'); expect(createTheme({ caps: caps('truecolor'), mode: 'auto', background: 'unknown' }).mode).toBe('dark'); expect(createTheme({ caps: caps('truecolor'), mode: 'auto' }).mode).toBe('dark');
  });
  it('an unknown token reads as text.primary and is noted once', () => { const logs: string[] = []; const t = createTheme({ caps: caps('truecolor'), mode: 'dark', log: { debug: (m) => logs.push(m) } }); expect(t.hex('nope' as Token)).toBe(t.hex('text.primary')); t.style('nope' as Token); expect(logs).toEqual(['theme.unknown_token']); });
});

describe('member colours', () => {
  it('you are violet, others take red, yellow, green, brown in slot order, the sixth is outlined violet', () => {
    expect(memberColor(1, 0).name).toBe('red'); expect(memberColor(2, 0).name).toBe('yellow'); expect(memberColor(3, 0).name).toBe('green'); expect(memberColor(4, 0).name).toBe('brown'); expect(memberColor(5, 0)).toMatchObject({ name: 'violet', outlined: true }); expect(memberColor(2, 2)).toMatchObject({ name: 'violet', outlined: false });
    expect([0, 1, 3, 4].map((s) => memberColor(s, 2).name)).toEqual(['red', 'yellow', 'green', 'brown']);
  });
  it('slots only: the same inputs always give the same colour, and no two members share one (up to five)', () => { for (const self of [0, 1, 2, 3, 4]) { const names = [0, 1, 2, 3, 4].map((s) => memberColor(s, self).name); expect(new Set(names).size).toBe(5); expect(memberColor(self, self).name).toBe('violet'); } });
});

describe('twelve looks', () => {
  const tiers: ColourTier[] = ['truecolor', '256', '16', 'none']; const modes: ThemeMode[] = ['dark', 'light', 'hc'];
  for (const tier of tiers) for (const mode of modes) it(`sample screen at ${tier} / ${mode}`, () => {
    const t = createTheme({ caps: caps(tier), mode }); const row = (tok: Token, s: string, bold = false) => t.paint(tok, s, { bold });
    const screen = [row('text.muted', 'cento · ~/app · main'), `${row('accent.primary', '▸', true)} ${row('text.primary', 'Fix the failing test')}`, row('status.success', t.status('success', 'tests passed')), row('status.danger', t.status('danger', 'error: build failed')), row('status.success.subtle', '+ added line'), row('status.danger.subtle', '- removed line'), row('status.warning', t.status('warning', 'Allow Cento to run npm test?'))].join('\n');
    expect(screen.replace(/\u001b/g, '␛')).toMatchSnapshot(); if (tier === 'none') expect(screen).not.toMatch(/\u001b\[[0-9;]*(3\d|4\d|9\d|38|48)/); expect(plain(screen)).toContain('✗ error: build failed');
  });
});
