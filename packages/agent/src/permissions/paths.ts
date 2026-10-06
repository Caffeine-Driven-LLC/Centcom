import { posix, win32 } from 'node:path';
import type { PermConfig } from './types.js';

export interface PathFs { realpath(p: string): Promise<string>; exists(p: string): Promise<boolean> }
const api = (os: 'posix' | 'win32') => (os === 'win32' ? win32 : posix);
const fold = (os: 'posix' | 'win32', s: string) => (os === 'win32' ? s.toLowerCase() : s);

/** Expand `~`, make absolute against `root`, remove `.` and `..`. Pure. */
export function lexicalPath(p: string, root: string, home: string, os: 'posix' | 'win32' = 'posix'): string {
  const a = api(os); let q = p; if (q === '~' || q.startsWith('~/') || q.startsWith('~\\')) q = a.join(home, q.slice(1)); return a.normalize(a.isAbsolute(q) ? q : a.join(root, q));
}
/** The same, then resolve symlinks on the deepest part that exists, so a link pointing out of the root is seen for what it is. */
export async function realPath(p: string, root: string, cfg: Pick<PermConfig, 'home' | 'os'>, fs: PathFs): Promise<string> {
  const os = cfg.os ?? 'posix'; const a = api(os); const lex = lexicalPath(p, root, cfg.home, os); let cur = lex; const tail: string[] = [];
  for (let i = 0; i < 64; i++) { if (await fs.exists(cur)) { try { return a.join(await fs.realpath(cur), ...tail.reverse()); } catch { return lex; } } const parent = a.dirname(cur); if (parent === cur) break; tail.push(a.basename(cur)); cur = parent; }
  return lex;
}
export function isInside(parent: string, child: string, os: 'posix' | 'win32' = 'posix'): boolean {
  const a = api(os); const rel = a.relative(fold(os, a.resolve(parent)), fold(os, a.resolve(child))); return rel === '' || (!rel.startsWith('..') && !a.isAbsolute(rel));
}
const CRED_DIRS = ['.ssh', '.aws', '.gnupg', '.codex', '.docker', '.kube', '.azure'];
const CRED_FILES = ['auth.json', '.credentials.json', '.netrc', '.npmrc', '.pgpass', 'login.keychain', 'login.keychain-db', 'secrets.json', 'id_rsa', 'id_ed25519', '.git-credentials'];
/** A path match on the request only (never reads the file): credential and keychain locations. */
export function isCredentialPath(real: string, os: 'posix' | 'win32' = 'posix'): boolean {
  const segs = fold(os, real).split(/[\\/]+/).filter(Boolean); const last = segs.at(-1) ?? '';
  if (segs.some((s) => CRED_DIRS.includes(s) || s.startsWith('.claude') || s === 'keychains' || s === 'gcloud')) return true;
  if (CRED_FILES.includes(last) || /\.keychain(-db)?$/.test(last) || /^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/.test(last)) return true;
  return false;
}
/** Anything inside a `.git` folder (or a `.git` file) is repository internals. */
export const isGitInternal = (real: string, os: 'posix' | 'win32' = 'posix') => fold(os, real).split(/[\\/]+/).includes('.git');

/** `**`, `*` and `?` globs. `*` stops at a slash. */
export function globToRegExp(glob: string): RegExp {
  let re = ''; for (let i = 0; i < glob.length; i++) { const c = glob[i]!; if (c === '*') { if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; } else re += '[^/]*'; } else if (c === '?') re += '[^/]'; else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&'); }
  return new RegExp(`^${re}$`);
}
