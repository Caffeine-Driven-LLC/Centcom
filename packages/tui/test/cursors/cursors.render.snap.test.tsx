import React from 'react';
import { renderToString } from 'ink';
import { createTheme, type ColorTier } from '@centcom/theme';
import { describe, expect, it } from 'vitest';
import { RemoteCursors, layoutCursors, tagLine } from '../../src/cursors/index.js';
import { ThemeCtx } from '../../src/components/ui.js';
import { cur, mapOf, roster, vp } from './helpers.js';

const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, ''); const small = { ...vp, lines: 8, cols: 70 };
const draw = (tier: ColorTier, mode: 'dark' | 'light' = 'dark', cursors = mapOf(cur('ada', { line: 1, col: 3, updatedAt: 0, selEndLine: 2, selEndCol: 6 }), cur('ben', { line: 4, col: 10, updatedAt: 0 }), cur('cy', { line: 6, col: 2, updatedAt: 0 }))) =>
  renderToString(<ThemeCtx.Provider value={createTheme(mode, tier)}><RemoteCursors cursors={cursors} roster={roster} viewport={small} selfMember="me" now={0} /></ThemeCtx.Provider>, { columns: 70 });
describe('rendering (acceptance 3, 4, 5)', () => {
  for (const tier of ['truecolor', '256', '16', 'none'] as const) for (const mode of ['dark', 'light'] as const)
    it(`${tier} ${mode}: initial and name are on screen (colour does not reach this renderer, so tier colours are checked on the spans)`, () => {
      const out = draw(tier, mode); const text = strip(out); expect(text).toContain('A Ada'); expect(text).toContain('B Benedikt-Al…'); expect(text).toContain('C Cy');
      expect(text).toMatchSnapshot();
    });
  it('NO_COLOR tags are reverse video with the name text', () => { const m = layoutCursors({ cursors: mapOf(cur('ada', { updatedAt: 0 })), roster, viewport: small, selfMember: 'me', now: 0 })[0]!; expect(tagLine(m, {})).toEqual([{ t: 'A Ada', r: true, d: false }]); expect(tagLine({ ...m, fresh: 'dim' }, {})[0]).toMatchObject({ d: true, r: true }); });
  it('your own cursor produces no tag, a hidden path draws nothing', () => { expect(strip(draw('none', 'dark', mapOf(cur('me', { updatedAt: 0 }))))).not.toContain('Me'); expect(strip(draw('none', 'dark', mapOf(cur('ada', { updatedAt: 0, path: 'x.ts' }))))).not.toContain('Ada'); });
});
describe('cost (acceptance 7)', () => {
  it('20 simultaneous cursors lay out and become spans in under 8 ms', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, name: `Member ${i}`, slot: i + 1 })); const cs = mapOf(...many.map((m, i) => cur(m.id, { line: i, col: i * 2, selEndLine: i + 1, selEndCol: 4, updatedAt: 0 })));
    const run = () => { const t = performance.now(); for (const m of layoutCursors({ cursors: cs, roster: [{ id: 'me', name: 'Me', slot: 0 }, ...many], viewport: vp, selfMember: 'me', now: 0 })) tagLine(m, { hex: '#ffffff' }); return performance.now() - t; };
    run(); expect(Math.min(run(), run(), run())).toBeLessThan(8);
  });
});
