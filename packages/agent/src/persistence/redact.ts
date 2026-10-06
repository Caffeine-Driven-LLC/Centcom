/** Everything written to a session log goes through here: secrets are replaced by `[redacted:<pattern>]` and long strings are cut. */
import { redactProviderText } from '../provider/detect/redact.js';

export function scrub(v: unknown, fieldBytes: number, redact: (s: string) => string = redactProviderText, depth = 0): unknown {
  if (typeof v === 'string') { const r = redact(v); return Buffer.byteLength(r) > fieldBytes ? cut(r, fieldBytes) + '…' : r; }
  if (v === null || typeof v !== 'object') return v;
  if (depth > 12) return '[too deep]';
  if (Array.isArray(v)) return v.map((x) => scrub(x, fieldBytes, redact, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if (/^(env|environment)$/i.test(k)) continue; /* never an environment dump */ out[k] = scrub(x, fieldBytes, redact, depth + 1); }
  return out;
}
/** Cuts to at most `bytes` UTF-8 bytes without splitting a character. */
export function cut(s: string, bytes: number): string { const b = Buffer.from(s); if (b.length <= bytes) return s; let end = bytes; while (end > 0 && (b[end]! & 0xc0) === 0x80) end--; return b.subarray(0, end).toString(); }
