import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE, hasWords, scan, scanSource } from '../../scripts/jsx-text.js';

describe('words written straight into the markup (C092: no raw strings in JSX text)', () => {
  it('finds text between tags and in aria-label, title, placeholder and alt, and ignores symbols, numbers, expressions and t() calls', () => {
    const src = `export const A = () => <div title="Close the box" aria-label={t('a.b')} data-x="not text"><b>Save changes</b>{t('x.y')}<i>·</i><span>12</span>&nbsp;<img alt="A cat" src="x" /><input placeholder="Search"/><p>{name}</p></div>;`;
    expect(scanSource('a.tsx', src).map((f) => f.text)).toEqual(['Close the box', 'Save changes', 'A cat', 'Search']);
    expect(hasWords('·')).toBe(false); expect(hasWords('12 / 30')).toBe(false); expect(hasWords('&nbsp;')).toBe(false); expect(hasWords('OK')).toBe(true);
  });
  it('a file never gets more of them than the baseline allows, and a file that is not in the baseline has none; move the text to en.json and run `pnpm exec tsx apps/web/scripts/jsx-text.ts --write`', () => {
    const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>; const now = scan();
    const worse = Object.entries(now).filter(([f, n]) => n > (base[f] ?? 0)).map(([f, n]) => `${f}: ${n} (allowed ${base[f] ?? 0})`);
    expect(worse).toEqual([]);
  });
});
