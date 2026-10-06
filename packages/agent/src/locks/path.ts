import { posix, win32 } from 'node:path';
import { PathOutsideRoot } from './errors.js';
import type { LockFs } from './types.js';

/** A relative key for a path inside the root: POSIX separators, NFC, lower case where the file system ignores case. `..`, absolute paths and anything resolving outside the root are refused. */
export function lexicalKey(path: string, o: { platform?: 'posix' | 'win32'; caseInsensitive?: boolean }): string {
  if (typeof path !== 'string' || !path || path.includes('\0')) throw new PathOutsideRoot(); const win = o.platform === 'win32'; let p = win ? path.replace(/\\/g, '/') : path;
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.startsWith('~') || p.startsWith('//')) throw new PathOutsideRoot();
  p = p.normalize('NFC'); const n = posix.normalize(p); if (n === '..' || n.startsWith('../') || n === '.' || n === '') throw new PathOutsideRoot();
  return o.caseInsensitive ? n.toLowerCase() : n;
}
/** The same, after looking where symlinks really lead: a link that points out of the root is refused, and two names for one file give one key. */
export async function canonicalKey(path: string, root: string, fs: LockFs, o: { platform?: 'posix' | 'win32'; caseInsensitive?: boolean }): Promise<string> {
  const lex = lexicalKey(path, o); const api = o.platform === 'win32' ? win32 : posix; const realRoot = await fs.realpath(root).catch(() => root);
  let cur = api.join(root, lex); const tail: string[] = [];
  for (let i = 0; i < 64; i++) { try { const real = await fs.realpath(cur); const full = api.join(real, ...tail.reverse()); const rel = api.relative(realRoot, full).split(api.sep).join('/'); if (rel === '' || rel === '..' || rel.startsWith('../') || api.isAbsolute(rel)) throw new PathOutsideRoot(); const n = rel.normalize('NFC'); return o.caseInsensitive ? n.toLowerCase() : n; } catch (e) { if (e instanceof PathOutsideRoot) throw e; const parent = api.dirname(cur); if (parent === cur) break; tail.push(api.basename(cur)); cur = parent; } }
  return lex;
}
