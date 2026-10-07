import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fmt, setLocale } from '../../src/i18n/index.js';
import { money } from '../../src/billing/model.js';

describe('money (acceptance 1)', () => {
  it('1900 USD and 1900 EUR from whole minor units', async () => { expect(money({ amount: 1900, currency: 'USD' })).toBe('$19.00'); expect(money({ amount: 1900, currency: 'EUR' })).toBe('€19.00'); await setLocale('en'); expect(fmt.money(5, 'USD')).toBe('$0.05'); expect(fmt.money(-250, 'USD')).toBe('-$2.50'); expect(fmt.money(123456789, 'USD')).toBe('$1,234,567.89'); expect(fmt.money(0, 'EUR')).toBe('€0.00'); });
  it('a fractional amount is refused, never rounded', () => { expect(() => fmt.money(19.5, 'USD')).toThrow(RangeError); expect(() => fmt.money(Number.NaN, 'USD')).toThrow(RangeError); });
  it('no code in the shell multiplies or divides money by floats', () => { const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)])); for (const f of walk(join(process.cwd(), 'apps/web/src')).filter((x) => /\.tsx?$/.test(x))) { const s = readFileSync(f, 'utf8'); expect(s, f).not.toMatch(/\*\s*0\.01|\/\s*100\b(?!\))[^;]*(cents|amount|minor)|(cents|amount|minor)[^;]*\/\s*100\b/); } });
});
