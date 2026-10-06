import { posix, win32 } from 'node:path';

/** A name made only of `a-z 0-9 -`: safe in a branch name and a folder name. */
export function slug(s: string, fallback = 'agent', max = 40): string {
  const out = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, ''); return out || fallback;
}
const SYSTEM = ['/', '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/boot', '/sys', '/proc', '/dev', '/var', '/root', '/System', '/Library', '/Applications'];
const WIN_SYSTEM = ['c:\\windows', 'c:\\program files', 'c:\\program files (x86)', 'c:\\programdata'];
/** Pure path helpers with the rules of one platform, so they can be tested for both. */
export function pathApi(os: 'posix' | 'win32') { return os === 'win32' ? win32 : posix; }
export function isInside(parent: string, child: string, os: 'posix' | 'win32' = 'posix'): boolean {
  const p = pathApi(os); const a = p.resolve(parent), b = p.resolve(child); const cmp = (x: string) => (os === 'win32' ? x.toLowerCase() : x); const rel = p.relative(cmp(a), cmp(b));
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel));
}
export function isSystemDir(path: string, os: 'posix' | 'win32' = 'posix'): boolean {
  const p = pathApi(os); const r = p.resolve(path); if (os === 'win32') { const l = r.toLowerCase(); return /^[a-z]:\\?$/.test(l) || WIN_SYSTEM.some((s) => l === s || l.startsWith(s + '\\')); }
  return SYSTEM.some((s) => (s === '/' ? r === '/' : r === s || r.startsWith(s + '/')));
}
/** A forward-slash form for registry files and comparisons. */
export const portable = (p: string): string => p.replace(/\\/g, '/');
/** Refs and names that could be taken for a git option are refused before git ever sees them. */
export const looksLikeOption = (s: string) => s.startsWith('-') || s.includes('\0') || /[\r\n]/.test(s);
