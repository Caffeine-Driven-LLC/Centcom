import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyTheme, contrast } from '../../shell/src/theme/theme.js';

const root = new URL('../../../../', import.meta.url); const tokens = JSON.parse(readFileSync(new URL('assets/theme/tokens.json', root), 'utf8')) as { semantic: Record<string, { dark: string; light: string }> }; const css = readFileSync(new URL('assets/theme/theme.css', root), 'utf8');
const section = (start: string): string => { const i = css.indexOf(start); return css.slice(i, css.indexOf('\n}', i)); };
describe('tokens (acceptance 4)', () => {
  it('every semantic token has a CSS variable in the dark block and the light block', () => {
    const dark = css.slice(0, css.indexOf(':root[data-theme="light"]')); const light = section(':root[data-theme="light"]');
    for (const name of Object.keys(tokens.semantic)) { const v = `--${name.replace(/\./g, '-')}:`; expect(dark, name).toContain(v); expect(light, name).toContain(v); }
  });
  it('text.primary on bg.base is at least 7:1, near the documented 16.64 and 17.41', () => {
    const t = tokens.semantic; expect(contrast(t['text.primary']!.dark, t['bg.base']!.dark)).toBeGreaterThan(16.5); expect(contrast(t['text.primary']!.light, t['bg.base']!.light)).toBeGreaterThan(17.3); expect(contrast(t['text.primary']!.dark, t['bg.base']!.dark)).toBeGreaterThanOrEqual(7);
  });
  it('switching changes data-theme on the root at once; auto removes it', () => {
    const attrs = new Map<string, string>(); const r = { setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) }; applyTheme('light', r); expect(attrs.get('data-theme')).toBe('light'); applyTheme('dark', r); expect(attrs.get('data-theme')).toBe('dark'); applyTheme('auto', r); expect(attrs.has('data-theme')).toBe(false);
  });
});
