/** What may be written into a crash report: no keys, tokens, message text, paths, repo or branch names. */
import { redactString } from '@centcom/net';

export interface ScrubCtx { home?: string; /** Names that must not appear: the repo folder, branch names, the user name. */ deny?: string[] }
/** An absolute path reduced to its package-relative form, or its last two parts. */
export function scrubPath(p: string): string {
  const norm = p.replace(/\\/g, '/'); const m = /(?:^|\/)((?:packages|apps)\/[\w@.-]+\/.*)$/.exec(norm); if (m) return m[1]!;
  const n = /(?:^|\/)(node_modules\/.*)$/.exec(norm); if (n) return n[1]!; const parts = norm.split('/').filter(Boolean); /* only the last two parts of a source file; any other file name could say too much */ return /\.(?:[cm]?[jt]sx?|json)$/.test(parts.at(-1) ?? '') ? parts.slice(-2).join('/') : '[path]';
}
/** Text with secrets, home folder, absolute paths and the deny-list removed. */
/** Token shapes the shared secret list does not cover yet (GitHub, Slack, Stripe, npm, Centcom keys). */
const MORE = [/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/g, /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g, /\bnpm_[A-Za-z0-9]{30,}/g, /\bcen_(?:live|test)_[A-Za-z0-9_]{12,}/g, /\bsk-[A-Za-z0-9_-]{20,}/g];
export function scrubText(s: string, c: ScrubCtx = {}): string {
  /* paths first (to the package-relative form), then secrets and the home folder, then the deny-list */
  let out = s.replace(/(?:file:\/\/)?(?:[A-Za-z]:)?(?:\/|\\)(?:[\w@.~+-]+(?:\/|\\))+[\w@.+-]+(?=[:)\s,'"]|$)/g, (m) => scrubPath(m.replace(/^file:\/\//, '')));
  out = redactString(out, c.home); for (const re of MORE) out = out.replace(re, '[redacted]');
  for (const d of c.deny ?? []) if (d && d.length >= 3) out = out.split(d).join('[removed]');
  return out;
}
