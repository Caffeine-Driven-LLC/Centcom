import { isCredentialPath, isGitInternal, isInside, lexicalPath } from '../permissions/paths.js';

export interface PathCtx { root: string; cwd: string; home: string; platform: 'posix' | 'win32' }
/** The places a write is always high risk (and, for credentials, so is a read). One list, shared with the permission engine's hard denies. */
export const PROTECTED_PATHS = ['.git/', '.env*', '~/.ssh', '~/.aws', '~/.gnupg', '~/.claude*', '~/.codex/*', 'shell start-up files (.bashrc, .zshrc, .profile ...)', '.centcom/', '.github/workflows/'] as const;
const RC = new Set(['.bashrc', '.bash_profile', '.bash_login', '.bash_logout', '.profile', '.zshrc', '.zshenv', '.zprofile', '.zlogin', '.zlogout', '.cshrc', '.tcshrc', '.kshrc', '.inputrc', '.gitconfig', '.npmrc', '.yarnrc', '.pypirc']);
/** Machine-level secrets outside any home folder. */
const SYSTEM_SECRETS = /^\/(etc\/(shadow|gshadow|master\.passwd|sudoers(\.d(\/.*)?)?|ssh\/ssh_host_.*)|root(\/.*)?|private\/etc\/(shadow|master\.passwd|sudoers))$/;
const norm = (os: 'posix' | 'win32', p: string) => (os === 'win32' ? p.toLowerCase().replace(/\\/g, '/') : p);
export const resolvePath = (p: string, c: PathCtx) => lexicalPath(p, c.cwd, c.home, c.platform);
export const escapesRoot = (p: string, c: PathCtx) => !isInside(c.root, resolvePath(p, c), c.platform);
/** String and path matching only: nothing is read. `write: false` is about reading, where only credential places count (and a real `.env`, not `.env.example`). */
export function isProtectedPath(p: string, c: PathCtx, o: { write?: boolean } = { write: true }): boolean {
  if (c.platform === 'win32' && /^(\\\\|\/\/)/.test(p)) return true; // `\\?\` and UNC paths cannot be judged
  const real = resolvePath(p, c); if (isCredentialPath(real, c.platform) || (c.platform === 'posix' && SYSTEM_SECRETS.test(real))) return true; const segs = norm(c.platform, real).split('/').filter(Boolean); const base = segs.at(-1) ?? '';
  if (/^\.env($|\.)/.test(base) && (o.write || !/\.(example|sample|template|dist)$/.test(base))) return true;
  if (!o.write) return false; if (isGitInternal(real, c.platform) || segs.includes('.centcom')) return true; if (RC.has(base) || (base === 'config.fish' && segs.at(-2) === 'fish')) return true;
  for (let i = 0; i + 1 < segs.length; i++) if (segs[i] === '.github' && segs[i + 1] === 'workflows') return true; return false;
}
