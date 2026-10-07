import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { detectCapabilities, layoutClass, mascotAllowed, parseOsc11, queryBackground, watchSize } from '../../src/terminal/index.js';

const tty = (columns = 100, rows = 40) => ({ isTTY: true, columns, rows }); const notTty = { isTTY: false } as { isTTY: boolean };
const U = { LANG: 'en_US.UTF-8' };

describe('colour tier', () => {
  const T = detectCapabilities;
  it.each([
    [{ COLORTERM: 'truecolor' }, tty(), 'truecolor'], [{ COLORTERM: '24bit' }, tty(), 'truecolor'], [{ COLORTERM: 'TRUECOLOR' }, tty(), 'truecolor'],
    [{ TERM: 'xterm-256color' }, tty(), '256'], [{ TERM: 'screen-256color' }, tty(), '256'], [{ TERM: 'xterm' }, tty(), '16'], [{}, tty(), '16'], [{ TERM: 'linux' }, tty(), '16'],
    [{ COLORTERM: 'truecolor', TERM: 'xterm-256color' }, tty(), 'truecolor'],
    [{ NO_COLOR: '1', COLORTERM: 'truecolor' }, tty(), 'none'], [{ NO_COLOR: 'yes' }, tty(), 'none'], [{ NO_COLOR: '0' }, tty(), 'none'],
    [{ NO_COLOR: '', COLORTERM: 'truecolor' }, tty(), 'truecolor'], [{ NO_COLOR: '', TERM: 'xterm' }, tty(), '16'],
    [{ COLORTERM: 'truecolor' }, notTty, 'none'], [{ TERM: 'xterm-256color' }, notTty, 'none'],
    [{ TERM: 'dumb' }, tty(), 'none'], [{ TERM: 'dumb', COLORTERM: 'truecolor' }, tty(), 'none'],
    [{ NO_COLOR: '1', TERM: 'xterm-256color' }, notTty, 'none'], [{ COLORTERM: 'yes' }, tty(), '16'],
  ])('%j gives %s', (env, out, want) => { expect(T(env as NodeJS.ProcessEnv, out as never).tier).toBe(want); });
});
describe('unicode and half blocks', () => {
  it('follows the locale and TERM=linux', () => {
    expect(detectCapabilities({ ...U, COLORTERM: 'truecolor' }, tty())).toMatchObject({ unicode: true, halfBlock: true });
    expect(detectCapabilities({ LANG: 'C', COLORTERM: 'truecolor' }, tty())).toMatchObject({ unicode: false, halfBlock: false });
    expect(detectCapabilities({ ...U, TERM: 'linux' }, tty())).toMatchObject({ unicode: false, halfBlock: false });
    expect(detectCapabilities({ LC_ALL: 'de_DE.utf8', LANG: 'C' }, tty()).unicode).toBe(true);
    expect(detectCapabilities({ ...U, NO_COLOR: '1' }, tty())).toMatchObject({ unicode: true, halfBlock: false });
  });
  it('flags hyperlinks and bracketed paste only on a real terminal', () => {
    expect(detectCapabilities({ ...U, TERM: 'xterm-256color' }, tty())).toMatchObject({ hyperlinks: true, bracketedPaste: true, isTTY: true });
    expect(detectCapabilities({ ...U, TERM: 'xterm-256color' }, notTty)).toMatchObject({ hyperlinks: false, bracketedPaste: false, isTTY: false });
  });
  it('is frozen', () => { expect(Object.isFrozen(detectCapabilities({}, tty()))).toBe(true); });
});
describe('env opt-outs', () => {
  it('reads typed values', () => { expect(detectCapabilities({ CENTO_MASCOT: 'off', CENTO_REDUCE_MOTION: '1', CENTO_SPINNER: 'plain', CENTO_THEME: 'light' }, tty())).toMatchObject({ mascotEnv: 'off', reduceMotionEnv: true, spinnerEnv: 'plain', themeEnv: 'light', warnings: [] }); });
  it('falls back to auto and warns on bad values, never throws', () => {
    const c = detectCapabilities({ CENTO_THEME: 'purple', CENTO_MASCOT: 'maybe', CENTO_SPINNER: 'x', CENTO_REDUCE_MOTION: 'sometimes' }, tty());
    expect(c).toMatchObject({ themeEnv: 'auto', mascotEnv: 'auto', spinnerEnv: 'auto', reduceMotionEnv: false }); expect(c.warnings).toHaveLength(4); expect(c.warnings[0]).toContain('CENTO_MASCOT=maybe');
  });
});
describe('layout', () => {
  it('classes', () => { expect([layoutClass(80, 24), layoutClass(79, 24), layoutClass(80, 23), layoutClass(39, 24), layoutClass(80, 9)]).toEqual(['ok', 'narrow', 'short', 'tiny', 'tiny']); });
  it('mascot needs 80x30 and not off', () => {
    const c = (cols: number, rows: number, mascotEnv: 'on' | 'off' | 'auto' = 'auto') => ({ cols, rows, mascotEnv });
    expect([mascotAllowed(c(80, 24)), mascotAllowed(c(80, 30)), mascotAllowed(c(120, 40, 'off')), mascotAllowed(c(79, 40))]).toEqual([false, true, false, false]);
  });
});

/** A fake terminal input that records raw mode and listeners. */
function fakeIo(isTTY = true) {
  const inp = Object.assign(new EventEmitter(), { isTTY, isRaw: false, raw: [] as boolean[], setRawMode(on: boolean) { this.isRaw = on; this.raw.push(on); }, resume() {}, pause() {} }); const written: string[] = [];
  return { inp, written, io: { out: { isTTY, write: (s: string) => written.push(s) }, inp: inp as never } };
}
const manual = () => { const t: { f: () => void; ms: number }[] = []; return { clock: { setTimeout: (f: () => void, ms: number) => { t.push({ f, ms }); return t.length; }, clearTimeout: (h: unknown) => { t[(h as number) - 1] = { f: () => undefined, ms: 0 }; } }, fire: () => t.forEach((x) => x.f()), t }; };
describe('background query', () => {
  it('parses 2- and 4-digit channels', () => { expect(parseOsc11('\x1b]11;rgb:0707/0909/1a1a\x07')).toBe('dark'); expect(parseOsc11('\x1b]11;rgb:f3f3/f6f6/ffff\x1b\\')).toBe('light'); expect(parseOsc11('rgb:ff/ff/ff')).toBe('light'); expect(parseOsc11('rgb:00/00/00')).toBe('dark'); expect(parseOsc11('nonsense')).toBeUndefined(); });
  it('resolves from the reply, which is consumed, and restores raw mode', async () => {
    const { io, inp, written } = fakeIo(); const p = queryBackground(io); expect(written).toEqual(['\x1b]11;?\x07']); inp.emit('data', Buffer.from('\x1b]11;rgb:0707/0909/1a1a\x07')); expect(await p).toBe('dark');
    expect(inp.raw).toEqual([true, false]); expect(inp.listenerCount('data')).toBe(0);
  });
  it('light, and unknown after 150 ms of silence', async () => {
    const a = fakeIo(); const pa = queryBackground(a.io); a.inp.emit('data', '\x1b]11;rgb:f3f3/f6f6/ffff\x07'); expect(await pa).toBe('light');
    const m = manual(); const b = fakeIo(); const pb = queryBackground(b.io, 150, m.clock); expect(m.t[0]!.ms).toBe(150); m.fire(); expect(await pb).toBe('unknown'); expect(b.inp.listenerCount('data')).toBe(0); expect(b.inp.raw.at(-1)).toBe(false);
  });
  it('writes nothing and answers unknown at once without a TTY', async () => { const { io, written } = fakeIo(false); expect(await queryBackground(io)).toBe('unknown'); expect(written).toEqual([]); });
});
describe('watchSize', () => {
  it('turns 10 resizes within 50 ms into one callback with the final size; the disposer removes the listener', () => {
    const out = Object.assign(new EventEmitter(), { columns: 100, rows: 40 }); const m = manual(); const got: unknown[] = [];
    const off = watchSize(out as never, (s) => got.push(s), m.clock);
    for (let i = 0; i < 10; i++) { out.columns = 100 + i; out.emit('resize'); } m.fire(); expect(got).toEqual([{ cols: 109, rows: 40 }]);
    off(); expect(out.listenerCount('resize')).toBe(0);
  });
});
