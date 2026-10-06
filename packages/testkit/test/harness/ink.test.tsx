import React from 'react';
import { describe, expect, it } from 'vitest';
import { Hello } from '../../src/harness/__fixtures__/Hello.js';
import { expectScreen, renderInk } from '../../src/index.js';

describe('renderInk (acceptance 5)', () => {
  it('colorTier none has no colour codes; truecolor has 38;2; sequences; 256 and 16 differ', async () => {
    const none = await renderInk(<Hello />, { colorTier: 'none' }); expect(none.lastFrame()).not.toMatch(/\u001b\[[0-9;]*m/); none.unmount();
    const named = await renderInk(<Hello />, { colorTier: 'truecolor' }); expect(named.lastFrame()).toContain('\u001b[32mok'); /* a named colour is the basic ANSI one at every tier */ named.unmount();
    const tc = await renderInk(<Hello />, { colorTier: 'truecolor' }); expect(tc.lastFrame()).toContain('38;2;'); tc.unmount();
    const c256 = await renderInk(<Hello />, { colorTier: '256' }); expect(c256.lastFrame()).toContain('38;5;'); expect(c256.lastFrame()).not.toContain('38;2;'); c256.unmount();
    const c16 = await renderInk(<Hello />, { colorTier: '16' }); expect(c16.lastFrame()).toMatch(/\u001b\[3[0-7]m/); expect(c16.lastFrame()).not.toContain('38;'); c16.unmount();
  });
  it('screen() is the plain rows; re-rendering adds a frame; the size is the one asked for', async () => {
    const r = await renderInk(<Hello />, { cols: 40, rows: 10 }); expect(r.screen()).toEqual(['ok', 'hex', 'hello world']); const n = r.frames.length; r.rerender(<Hello name="Maya" />); await new Promise((x) => setImmediate(x)); expect(r.frames.length).toBeGreaterThan(n); expect(r.screen()).toEqual(['ok', 'hex', 'hello Maya']); r.unmount();
  });
  it('expectScreen compares the plain text with a stored snapshot', async () => { const r = await renderInk(<Hello />); expectScreen(r.screen()).toMatchSnapshot(); expect(expectScreen(['a  ', 'b\u001b[31m  ', '']).text).toBe('a\nb'); r.unmount(); });
});
