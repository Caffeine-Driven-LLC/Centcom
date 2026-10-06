/** Key strings: `ctrl+shift+p`, `pageup`, `?`, and two-step chords like `ctrl+x ctrl+s`. */
export interface KeyStep { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key: string }
export type KeyChord = KeyStep[];
export class KeyParseError extends Error { constructor(readonly input: string, readonly reason: string) { super(`Not a key: "${input}" (${reason})`); this.name = 'KeyParseError'; } }
export const NAMED = ['enter', 'esc', 'tab', 'space', 'backspace', 'delete', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`)] as const;
const MODS = ['ctrl', 'alt', 'shift', 'meta'] as const;
const ALIAS: Record<string, string> = { escape: 'esc', return: 'enter', del: 'delete', pgup: 'pageup', pgdn: 'pagedown', arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', option: 'alt', cmd: 'meta', command: 'meta', control: 'ctrl' };

function step(s: string, whole: string): KeyStep | KeyParseError {
  if (!s) return new KeyParseError(whole, 'empty step'); const k: KeyStep = { ctrl: false, alt: false, shift: false, meta: false, key: '' };
  // the last `+` separates the key, unless the key itself is `+`
  const parts = s.endsWith('++') ? [...s.slice(0, -2).split('+').filter((x) => x !== ''), '+'] : s.split('+'); const key = parts.pop()!; if (!key) return new KeyParseError(whole, 'no key after a modifier');
  for (const m of parts) { const mm = (ALIAS[m.toLowerCase()] ?? m.toLowerCase()) as (typeof MODS)[number]; if (!MODS.includes(mm)) return new KeyParseError(whole, `unknown modifier "${m}"`); if (k[mm]) return new KeyParseError(whole, `"${m}" twice`); k[mm] = true; }
  const lower = ALIAS[key.toLowerCase()] ?? key.toLowerCase();
  if ((NAMED as readonly string[]).includes(lower)) k.key = lower; else if ([...key].length === 1) k.key = k.ctrl || k.alt || k.meta ? key.toLowerCase() : key; else return new KeyParseError(whole, `unknown key "${key}"`);
  return k;
}
export function parseKey(s: string): KeyChord | KeyParseError {
  if (typeof s !== 'string') return new KeyParseError(String(s), 'not text'); const t = s.trim(); if (!t) return new KeyParseError(s, 'empty');
  const steps = t === ' ' ? ['space'] : t.split(/\s+/); if (steps.length > 2) return new KeyParseError(s, 'chords have at most 2 steps');
  const out: KeyChord = []; for (const p of steps) { const r = step(p, s); if (r instanceof KeyParseError) return r; out.push(r); } return out;
}
export const formatStep = (k: KeyStep) => [k.ctrl && 'ctrl', k.alt && 'alt', k.shift && 'shift', k.meta && 'meta', k.key].filter(Boolean).join('+');
export const formatKey = (c: KeyChord) => c.map(formatStep).join(' ');
export const sameStep = (a: KeyStep, b: KeyStep) => a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta && a.key === b.key;
