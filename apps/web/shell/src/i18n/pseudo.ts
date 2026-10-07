/** `en-XA`: accented letters and about 30 % more characters, with the {placeholders} left alone, so a layout that clips shows it early. */
const MAP: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', c: 'ç', n: 'ñ', s: 'š' };
export function pseudo(msg: string): string {
  let out = ''; let depth = 0; let letters = 0;
  for (const ch of msg) { if (ch === '{') depth++; if (depth === 0) { out += MAP[ch] ?? ch; letters++; } else out += ch; if (ch === '}') depth = Math.max(0, depth - 1); }
  const pad = '~'.repeat(Math.ceil(letters * 0.3)); return `[${out}${pad}]`;
}
