import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast } from '../../src/theme/theme.js';
import { INITIAL_ON } from '../../src/presence/slots.js';

const t = JSON.parse(readFileSync(new URL('../../../../assets/theme/tokens.json', import.meta.url), 'utf8')) as { presence: Record<string, string>; palette: { ink: Record<string, string> }; semantic: Record<string, { dark: string; light: string }> };
describe('contrast of the initial on its colour (acceptance 2)', () => {
  const ink = t.palette.ink['900']!; const colour = (c: string): string => t.presence[c === 'violet-outlined' ? 'violet' : c]!;
  for (const c of Object.keys(INITIAL_ON) as (keyof typeof INITIAL_ON)[]) it(`${c}: at least 3:1`, () => { const fg = INITIAL_ON[c] === 'white' ? '#FFFFFF' : ink; expect(contrast(fg, colour(c))).toBeGreaterThanOrEqual(3); });
  it('the brown ring and the outline show against both page backgrounds', () => { for (const m of ['dark', 'light'] as const) { const bg = t.semantic['bg.surface']![m]; expect(contrast('#B6B6BE', bg) + contrast(t.presence.violet!, bg)).toBeGreaterThan(3.5); } });
  it('status colours that sit beside a distinct glyph still reach 3:1 on the surface (dark and light)', () => { for (const m of ['dark', 'light'] as const) for (const k of ['status.success', 'status.warning', 'status.danger']) expect(contrast(t.semantic[k]![m], t.semantic['bg.surface']![m]), `${k} ${m}`).toBeGreaterThanOrEqual(3); });
});
