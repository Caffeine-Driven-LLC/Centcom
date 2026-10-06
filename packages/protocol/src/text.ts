/** CT-IDS text rules: UTF-8, NFC at the API boundary, control characters other than \n and \t rejected. */
export class TextError extends Error { constructor(public code: 'control_character' | 'too_long' | 'empty' | 'bad_slug', message: string) { super(message); this.name = 'TextError'; } }

export const LIMITS = { displayName: 40, workspaceName: 60, sessionName: 80 } as const;
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/; // everything below U+0020 except \t (09) and \n (0A), plus DEL

/** NFC-normalise, reject control characters, and enforce 1..max characters (counted as code points, not UTF-16 units). */
export function normalizeText(s: string, o: { max: number; min?: number }): string {
  const n = s.normalize('NFC');
  if (CONTROL.test(n)) throw new TextError('control_character', 'Text contains a control character.');
  const len = [...n].length; if (len < (o.min ?? 1)) throw new TextError('empty', 'Text is empty.'); if (len > o.max) throw new TextError('too_long', `Text is longer than ${o.max} characters.`);
  return n;
}
export const displayName = (s: string) => normalizeText(s, { max: LIMITS.displayName });
export const workspaceName = (s: string) => normalizeText(s, { max: LIMITS.workspaceName });
export const sessionName = (s: string) => normalizeText(s, { max: LIMITS.sessionName });
export const isSlug = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9-]{3,40}$/.test(s);
export function slug(s: string): string { if (!isSlug(s)) throw new TextError('bad_slug', 'A slug is 3 to 40 of a-z, 0-9 and -.'); return s; }
