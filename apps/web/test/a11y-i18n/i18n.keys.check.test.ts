import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { check } from '../../scripts/i18n-check.js';

describe('key check (acceptance 1)', () => {
  it('every key used in the shell exists in en.json', () => { expect(check().missing).toEqual([]); });
  it('a key that does not exist is reported with its file, an unused key is only listed', () => {
    const d = mkdtempSync(join(tmpdir(), 'cc-i18n-')); mkdirSync(join(d, 'i18n')); mkdirSync(join(d, 'x')); writeFileSync(join(d, 'i18n/en.json'), JSON.stringify({ 'a.ok': 'A', 'a.unused': 'B' })); writeFileSync(join(d, 'x/page.tsx'), "export const a = t('a.ok'); export const b = t('a.nope'); export const n = { labelKey: 'a.navmissing' };");
    expect(check(d + '/')).toEqual({ missing: [{ key: 'a.nope', file: 'x/page.tsx' }, { key: 'a.navmissing', file: 'x/page.tsx' }], unused: ['a.unused'] });
  });
});
