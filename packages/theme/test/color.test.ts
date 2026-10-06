import { describe, expect, it } from 'vitest';
import { detectColorTier, hexToRgb, nearest16, nearest256, sgr, createTheme } from '../src/index.js';

describe('detectColorTier', () => {
  const tty = (env: Record<string, string>, flag?: string) => detectColorTier({ env, isTTY: true, flag });
  it('honours NO_COLOR and non-TTY', () => {
    expect(tty({ NO_COLOR: '1', COLORTERM: 'truecolor' })).toBe('none');
    expect(detectColorTier({ env: { COLORTERM: 'truecolor' }, isTTY: false })).toBe('none');
  });
  it('detects truecolor from COLORTERM and known terminals', () => {
    expect(tty({ COLORTERM: 'truecolor' })).toBe('truecolor');
    expect(tty({ TERM: 'xterm-kitty' })).toBe('truecolor');
  });
  it('falls back to 256 and 16', () => {
    expect(tty({ TERM: 'xterm-256color' })).toBe('256');
    expect(tty({ TERM: 'xterm' })).toBe('16');
  });
  it('flags override the environment', () => {
    expect(tty({ NO_COLOR: '1' }, 'truecolor')).toBe('truecolor');
    expect(tty({ COLORTERM: 'truecolor' }, 'never')).toBe('none');
  });
});

describe('colour conversion', () => {
  it('maps exact cube and grey values to themselves', () => {
    expect(nearest256([255, 255, 255])).toBe(231);
    expect(nearest256([0, 0, 0])).toBe(16);
    expect(nearest256([95, 135, 175])).toBe(16 + 36 * 1 + 6 * 2 + 3);
  });
  it('maps pure primaries to the expected ANSI slots', () => {
    expect(nearest16([205, 49, 49])).toBe(1);
    expect(nearest16([241, 76, 76])).toBe(9);
    expect(nearest16([0, 0, 0])).toBe(0);
  });
  it('builds SGR strings per tier', () => {
    expect(sgr('#7c5cff', 'truecolor', 'fg')).toBe('38;2;124;92;255');
    expect(sgr('#7c5cff', '256', 'bg')).toMatch(/^48;5;\d+$/);
    expect(sgr('#f14c4c', '16', 'fg')).toBe('91');
    expect(sgr('#cd3131', '16', 'bg')).toBe('41');
    expect(sgr('#ff0000', 'none', 'fg')).toBe('');
  });
  it('parses hex', () => { expect(hexToRgb('#0b1026')).toEqual([11, 16, 38]); expect(hexToRgb('fff')).toEqual([255, 255, 255]); });
});

describe('theme', () => {
  it('resolves semantic tokens per mode', () => {
    expect(createTheme('dark', 'truecolor').c('bg.base')).toBe('#07091A');
    expect(createTheme('light', 'truecolor').c('bg.base')).toBe('#F3F6FF');
    expect(createTheme('dark', 'none').presence).toHaveLength(5);
  });
});
