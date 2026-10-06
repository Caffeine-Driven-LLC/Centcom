/** Redaction for log records. Runs in the logger core on every record; there is no way to turn it off. */
import { REDACTED, looksLikeSecret as contractSecret, redact as redactSecrets } from '@centcom/protocol';

export const MAX_DEPTH = 6, MAX_STRING = 2048, MAX_ARRAY = 50;
/** Keys whose values are never logged. Broad on purpose: callers log ids and enums, and rename a field (agent_id, not path) if they truly need it. */
const DENY = new Set(['token', 'access_token', 'refresh_token', 'id_token', 'authorization', 'cookie', 'set-cookie', 'password', 'passwd', 'secret', 'key', 'api_key', 'apikey', 'private_key', 'ct', 'c', 'n', 'sig', 'signature', 'text', 'body', 'delta', 'command', 'cwd', 'path', 'paths', 'file', 'files', 'filename', 'branch', 'worktree', 'diff', 'prompt', 'content', 'summary', 'email', 'detail', 'stderr', 'stdout', 'output', 'message_body']);
const denyKey = (k: string) => DENY.has(k.toLowerCase()) || /(^|_|-)(token|secret|password|passwd|apikey|api_key|private_key)(_|-|$)/i.test(k);

const EXTRA_PATTERNS: [RegExp, string][] = [
  [/(?<![A-Za-z0-9_])cen_(live|test)_[A-Za-z0-9_-]{8,}/g, REDACTED], // Centcom API keys
  [/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, REDACTED], // JWTs, even short ones
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, REDACTED], // email addresses
  [/(?<![\w:/.~-])\/(?!v\d+\/)(?:[\w.@+~-]+\/)+[\w.@+~-]*/g, '[path]'], // absolute paths with 2+ segments (REST routes like /v1/... are fine)
  [/(?<![\w])[A-Za-z]:\\(?:[^\\\s"'<>|]+\\)*[^\\\s"'<>|]*/g, '[path]'], // Windows paths
  [/(?<![\w~])~\/[\w.@+~/-]+/g, '[path]'],
];
/** Long base64url runs look like ciphertext or keys. Hex digests (sha256...), ULIDs and versions are fine. */
const LONG_B64 = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{48,}(?![A-Za-z0-9_-])/g;
const isHex = (s: string) => /^[0-9a-fA-F]+$/.test(s);

export function redactString(s: string, home?: string): string {
  let out = redactSecrets(s);
  for (const [re, rep] of EXTRA_PATTERNS) out = out.replace(re, rep);
  out = out.replace(LONG_B64, (m) => (isHex(m) ? m : REDACTED));
  if (home && home.length > 2) out = out.split(home).join('~');
  if (out.length > MAX_STRING) out = `${out.slice(0, MAX_STRING)}...[truncated ${out.length - MAX_STRING}]`;
  return out;
}

/** Deep, cycle-safe, bounded, never throws. Depth beyond 6 and arrays beyond 50 items are cut. */
export function redactValue(v: unknown, home?: string, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  try {
    if (typeof v === 'string') return redactString(v, home);
    if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'function' || typeof v === 'symbol') return `[${typeof v}]`;
    if (depth >= MAX_DEPTH) return '[depth]';
    if (typeof v === 'object') {
      if (seen.has(v)) return '[circular]'; seen.add(v);
      if (v instanceof Error) return { name: v.name, message: redactString(v.message, home), ...(v.cause !== undefined ? { cause: redactValue(v.cause, home, depth + 1, seen) } : {}) };
      if (Array.isArray(v)) { const out = v.slice(0, MAX_ARRAY).map((x) => redactValue(x, home, depth + 1, seen)); if (v.length > MAX_ARRAY) out.push(`[${v.length - MAX_ARRAY} more]`); return out; }
      if (v instanceof Uint8Array) return `[${v.length} bytes]`;
      const out: Record<string, unknown> = {}; let n = 0;
      for (const k of Object.keys(v as object)) {
        if (++n > 100) { out['...'] = '[more keys]'; break; }
        if (denyKey(k)) { out[k] = REDACTED; continue; }
        try { out[k] = redactValue((v as Record<string, unknown>)[k], home, depth + 1, seen); } catch { out[k] = '[unreadable]'; } // a getter that throws must not take the record down
      }
      return out;
    }
    return REDACTED;
  } catch { return REDACTED; }
}
/** True when the text contains anything redaction would remove (credentials, emails, paths, long opaque strings). Reusable by other lanes. */
export const looksLikeSecret = (s: string): boolean => { const t = s.slice(0, MAX_STRING); return contractSecret(t) || redactString(t) !== t; };
/** Pure, safe on any input: the logger's redactor under the name the other lanes use. */
export const redact = redactValue;
export { denyKey };
