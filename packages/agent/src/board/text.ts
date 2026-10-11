import { redact } from '@centcom/protocol';

/** Escape sequences (CSI and OSC) and every control, separator or direction-changing character. Written with escapes so the source holds no invisible characters. */
const ESC = new RegExp('\\u001b\\[[0-9;?]*[ -\\/]*[@-~]|\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)?', 'g');
const CTRL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069]', 'g');
export const MAX_TEXT = 280; export const MAX_FILES = 8; export const MAX_COMMANDS = 3;
/** One line of plain text that is safe to show to a person and to put in front of an agent: no control codes, no escape sequences, no angle brackets (so a note can never close or fake the delimiter of the block it is delivered in), secrets removed, cut at 280 characters. */
export function cleanText(s: unknown, max = MAX_TEXT): string {
  if (typeof s !== 'string') return '';
  const t = redact(s).replace(ESC, '').replace(CTRL, ' ').replace(/</g, '‹').replace(/>/g, '›').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}
/** A project-relative path with `/` separators, or undefined (absolute paths, `..`, empty and over-long ones are not stored). */
export function cleanPath(p: unknown): string | undefined {
  if (typeof p !== 'string') return undefined; let s = p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/'); if (!s || s.length > 200 || s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.split('/').includes('..')) return undefined;
  s = s.replace(CTRL, '').replace(/[<>]/g, ''); return s || undefined;
}
export const estimateTokens = (s: string): number => Math.ceil(s.length / 4);
