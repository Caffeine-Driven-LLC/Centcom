// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { detectLocale, fmt, format, registerLocale, setLocale, t, tp, useLocale } from '../../shell/src/i18n/index.js';
import { pseudo } from '../../shell/src/i18n/pseudo.js';

afterEach(async () => { cleanup(); await setLocale('en'); });
describe('pseudo-locale en-XA (acceptance 2)', () => {
  it('grows text by about 30 %, accents the letters and leaves the {placeholders} alone', () => { const s = 'Changes will not be saved until the connection is back.'; const p = pseudo(s); expect(p.length).toBeGreaterThanOrEqual(s.length * 1.3); expect(p.startsWith('[')).toBe(true); expect(p).toContain('ñ'); expect(pseudo('Hello {name}, you have {count} items')).toContain('{name}'); expect(pseudo('Hello {name}')).toContain('{name}'); expect(pseudo('{n, plural, one {a file} other {# files}}')).toContain('{n, plural'); });
  it('switching the language changes the words and <html lang>, and every string still fits its parameters', async () => {
    const Hello = () => { const { locale } = useLocale(); return <p>{locale}:{t('nav.menu')}</p>; }; render(<Hello />); expect(screen.getByText('en:Menu')).toBeTruthy(); expect(document.documentElement.lang).toBe('en');
    await setLocale('en-XA'); expect(t('nav.menu')).toMatch(/^\[Méñú~*\]$/); expect(t('count.members', { count: 3 })).toContain('3'); expect(document.documentElement.lang).toBe('en'); await screen.findByText(/en-XA:\[/); expect(tp('nav.menu')).toBe(t('nav.menu'));
  });
});
describe('language handling', () => {
  it('plurals and parameters', () => { expect(format('{count, plural, =0 {none} one {# file} other {# files}}', { count: 0 })).toBe('none'); expect(format('{count, plural, one {# file} other {# files}}', { count: 1 })).toBe('1 file'); expect(format('{count, plural, one {# file} other {# files}}', { count: 5 })).toBe('5 files'); expect(format('Hi {name}!', { name: 'Ada' })).toBe('Hi Ada!'); expect(format('Hi {name}!')).toBe('Hi {name}!'); expect(format('open {', {})).toBe('open {'); expect(t('count.unread', { count: 1 })).toBe('1 unread notification'); expect(t('count.unread', { count: 0 })).toBe('No unread notifications'); });
  it('a language chunk loads only when asked, falls back to English for a missing key, and a failing load keeps English', async () => {
    let loads = 0; registerLocale('de', async () => { loads++; return { default: { 'nav.menu': 'Menü' } }; }); expect(loads).toBe(0); await setLocale('de'); expect(loads).toBe(1); expect(t('nav.menu')).toBe('Menü'); expect(t('nav.details')).toBe('Details'); expect(document.documentElement.lang).toBe('de'); registerLocale('fr', async () => { throw new Error('offline'); }); await setLocale('fr'); expect(t('nav.menu')).toBe('Menu'); expect(document.documentElement.lang).toBe('en');
  });
  it('detection: the person\'s choice, then the browser, then English', () => { registerLocale('de', async () => ({ default: {} })); expect(detectLocale({ me: 'de', navigator: ['en-US'] })).toBe('de'); expect(detectLocale({ navigator: ['de-CH', 'en'] })).toBe('de'); expect(detectLocale({ navigator: ['ja'] })).toBe('en'); expect(detectLocale({})).toBe('en'); });
  it('dates, numbers and money follow the language', async () => { expect(fmt.number(1234.5)).toBe('1,234.5'); expect(fmt.money(1999, 'USD')).toBe('$19.99'); expect(fmt.date(Date.UTC(2026, 9, 7), { dateStyle: 'medium', timeZone: 'UTC' })).toBe('Oct 7, 2026'); });
  it('English is small: the table is well under 10 KB gzip', () => { expect(gzipSync(readFileSync(join(process.cwd(), 'apps/web/shell/src/i18n/en.json'))).length).toBeLessThanOrEqual(10 * 1024); });
});
