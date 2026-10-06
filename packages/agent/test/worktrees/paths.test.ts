import { describe, expect, it } from 'vitest';
import { isInside, isSystemDir, looksLikeOption, portable, slug } from '../../src/index.js';

describe('path helpers (both platforms)', () => {
  it('posix: inside, outside, sibling-with-same-prefix, parent traversal', () => { expect(isInside('/a/repo', '/a/repo/.centcom/wt')).toBe(true); expect(isInside('/a/repo', '/a/repo')).toBe(true); expect(isInside('/a/repo', '/a/repo2/x')).toBe(false); expect(isInside('/a/repo', '/a/repo/../other')).toBe(false); });
  it('windows: backslashes, drive letters and case are handled', () => { expect(isInside('C:\\Users\\Me\\repo', 'c:\\users\\me\\REPO\\.centcom\\wt', 'win32')).toBe(true); expect(isInside('C:\\Users\\Me\\repo', 'D:\\other', 'win32')).toBe(false); expect(isInside('C:\\Users\\Me\\repo', 'C:\\Users\\Me\\repo2', 'win32')).toBe(false); });
  it('system directories are recognised on both platforms', () => { for (const p of ['/', '/etc', '/etc/x', '/usr/local', '/var/lib']) expect(isSystemDir(p), p).toBe(true); for (const p of ['/home/u/repo', '/tmp/x', '/Users/me/p']) expect(isSystemDir(p), p).toBe(false); for (const p of ['C:\\', 'C:\\Windows', 'c:\\windows\\system32', 'C:\\Program Files\\x']) expect(isSystemDir(p, 'win32'), p).toBe(true); expect(isSystemDir('C:\\Users\\me\\repo', 'win32')).toBe(false); });
  it('portable turns backslashes into slashes', () => { expect(portable('C:\\a\\b')).toBe('C:/a/b'); });
  it('slug keeps only a-z, 0-9 and single dashes, never starts or ends with a dash, and falls back', () => { expect(slug('Hello  World!!')).toBe('hello-world'); expect(slug('../..//x')).toBe('x'); expect(slug('✓✓✓')).toBe('agent'); expect(slug('', 'owner')).toBe('owner'); expect(slug('a'.repeat(100)).length).toBe(40); expect(slug('ÅÄÖ café')).toBe('aao-cafe'); });
  it('option-looking strings are caught', () => { expect(looksLikeOption('-x')).toBe(true); expect(looksLikeOption('--upload-pack=x')).toBe(true); expect(looksLikeOption('main')).toBe(false); expect(looksLikeOption('a\0b')).toBe(true); expect(looksLikeOption('a\nb')).toBe(true); });
});
