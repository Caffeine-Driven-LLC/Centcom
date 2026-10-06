/** Keeps credentials out of anything that is shown, logged or sent. Patterns come from the contract (CT-PROVIDER rule 1). */
import { SECRET_PATTERNS } from './generated/secret-patterns.js';

// compiled once; these are plain RegExp objects, not generated code
const COMPILED = SECRET_PATTERNS.map((p) => ({ id: p.id, re: new RegExp(p.regex, 'g') }));
// not in the contract list, but never wanted anywhere either
const EXTRA = [{ id: 'private_key_block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g }];

export const REDACTED = '[redacted]';

/** Ids of the patterns that match (never the matched text). */
export function secretKinds(text: string): string[] {
  const out: string[] = [];
  for (const { id, re } of [...COMPILED, ...EXTRA]) { re.lastIndex = 0; if (re.test(text)) out.push(id); }
  return out;
}
export const looksLikeSecret = (text: string): boolean => secretKinds(text).length > 0;

/** Replace every secret-looking span with `[redacted]`. */
export function redact(text: string, replacement = REDACTED): string {
  let out = text; for (const { re } of [...COMPILED, ...EXTRA]) { re.lastIndex = 0; out = out.replace(re, replacement); } return out;
}
