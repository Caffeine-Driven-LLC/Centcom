import { describe, expect, it } from 'vitest';
import { canonicalKey, lexicalKey, nodeLockFs } from '../../src/index.js';
import { tmp } from './helpers.js';

describe('path keys (acceptance 2)', () => {
  it('src/A.ts and src/a.ts collide when the file system ignores case, and not otherwise', () => { expect(lexicalKey('src/A.ts', { caseInsensitive: true })).toBe(lexicalKey('src/a.ts', { caseInsensitive: true })); expect(lexicalKey('src/A.ts', {})).not.toBe(lexicalKey('src/a.ts', {})); });
  it('is relative, POSIX, normalised and NFC', () => { expect(lexicalKey('./src//x/../y.ts', {})).toBe('src/y.ts'); expect(lexicalKey('src\\y.ts', { platform: 'win32' })).toBe('src/y.ts'); expect(lexicalKey('e\u0301.ts', {})).toBe('\u00e9.ts'); });
  it.each(['../x', 'a/../../x', '/etc/passwd', '..', '.', '', '~/x', 'C:\\x', '//host/share', 'a\0b'])('%j is refused', (p) => { expect(() => lexicalKey(p, { platform: p.includes('\\') ? 'win32' : 'posix' })).toThrow(expect.objectContaining({ name: 'PathOutsideRoot' })); });
  it('a symlink that leaves the root is refused; one that stays gives the same key as its target', async () => {
    const outside = tmp(); outside.put('secret.txt'); const t = tmp(); t.put('real/f.txt'); t.link(outside.dir, 'out'); t.link(`${t.dir}/real`, 'alias'); t.link('real/f.txt', 'file-link');
    await expect(canonicalKey('out/secret.txt', t.dir, nodeLockFs, {})).rejects.toMatchObject({ name: 'PathOutsideRoot' }); await expect(canonicalKey('out/new.txt', t.dir, nodeLockFs, {})).rejects.toMatchObject({ name: 'PathOutsideRoot' });
    expect(await canonicalKey('alias/f.txt', t.dir, nodeLockFs, {})).toBe('real/f.txt'); expect(await canonicalKey('file-link', t.dir, nodeLockFs, {})).toBe('real/f.txt'); expect(await canonicalKey('real/not-yet/new.ts', t.dir, nodeLockFs, {})).toBe('real/not-yet/new.ts');
  });
});
