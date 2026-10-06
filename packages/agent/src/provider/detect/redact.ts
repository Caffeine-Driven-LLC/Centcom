import { SECRET_PATTERNS } from '@centcom/protocol';

const COMPILED = SECRET_PATTERNS.map((p) => ({ id: p.id, re: new RegExp(p.regex, 'g') }));
/** Every string that leaves this module goes through here. A match is replaced by `[redacted:<pattern id>]`; the raw text is not kept. */
export function redactProviderText(s: string): string { let out = s; for (const { id, re } of COMPILED) { re.lastIndex = 0; out = out.replace(re, `[redacted:${id}]`); } return out; }
/** Ids of the patterns that match, never the matched text. */
export function leakIds(s: string): string[] { return COMPILED.filter(({ re }) => { re.lastIndex = 0; return re.test(s); }).map((p) => p.id); }
