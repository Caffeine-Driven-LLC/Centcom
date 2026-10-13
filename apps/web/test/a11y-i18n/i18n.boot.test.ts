// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { bootLocale } from '../../src/i18n/boot.js';
import { currentLocale, registerLocale, setLocale, t } from '../../src/i18n/index.js';

afterEach(async () => { await setLocale('en'); });
describe('the language at start (C092 failure modes)', () => {
  it('uses English when nothing else is available, and sets <html lang>', async () => { expect(await bootLocale({ navigator: ['xx-YY'] })).toBe('en'); expect(document.documentElement.lang).toBe('en'); });
  it('follows the saved choice first, then the browser, picking the closest available language', async () => {
    registerLocale('de', async () => ({ default: { 'a11y.shortcuts.title': 'Tastenkürzel' } }));
    expect(await bootLocale({ navigator: ['de-AT', 'en'] })).toBe('de'); expect(currentLocale()).toBe('de'); expect(document.documentElement.lang).toBe('de'); expect(t('a11y.shortcuts.title')).toBe('Tastenkürzel');
    expect(await bootLocale({ me: 'en-XA', navigator: ['de'] })).toBe('en-XA'); expect(document.documentElement.lang).toBe('en');
  });
  it('a language chunk that fails to load falls back to English; a key missing from a language shows the English words', async () => {
    registerLocale('fr', async () => { throw new Error('offline'); }); expect(await bootLocale({ navigator: ['fr'] })).toBe('fr'); expect(currentLocale()).toBe('en'); expect(t('a11y.shortcuts.title')).toBe('Keyboard shortcuts');
    registerLocale('es', async () => ({ default: {} })); await setLocale('es'); expect(t('a11y.shortcuts.title')).toBe('Keyboard shortcuts');
  });
});
