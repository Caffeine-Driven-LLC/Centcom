/** Turns what the terminal sends into a KeyStep: Ink's `useInput` arguments, or raw bytes (legacy control codes, ESC-prefixed alt, CSI u). */
import type { KeyStep } from './parse.js';

export interface InkKey { upArrow?: boolean; downArrow?: boolean; leftArrow?: boolean; rightArrow?: boolean; pageUp?: boolean; pageDown?: boolean; home?: boolean; end?: boolean; return?: boolean; escape?: boolean; ctrl?: boolean; shift?: boolean; tab?: boolean; backspace?: boolean; delete?: boolean; meta?: boolean }
const blank = (key: string, o: Partial<KeyStep> = {}): KeyStep => ({ ctrl: false, alt: false, shift: false, meta: false, key, ...o });
export function fromInk(input: string, k: InkKey): KeyStep | undefined {
  const mods = { ctrl: !!k.ctrl, alt: !!k.meta && !k.escape, shift: !!k.shift, meta: false };
  const named = k.upArrow ? 'up' : k.downArrow ? 'down' : k.leftArrow ? 'left' : k.rightArrow ? 'right' : k.pageUp ? 'pageup' : k.pageDown ? 'pagedown' : k.home ? 'home' : k.end ? 'end' : k.return ? 'enter' : k.escape ? 'esc' : k.tab ? 'tab' : k.backspace ? 'backspace' : k.delete ? 'delete' : undefined;
  if (named) return blank(named, mods);
  if (!input) return undefined; if (input === ' ') return blank('space', mods);
  const ch = [...input][0]!; return blank(mods.ctrl || mods.alt ? ch.toLowerCase() : ch, { ...mods, shift: mods.shift && /[a-z]/i.test(ch) && !(ch === ch.toUpperCase() && ch !== ch.toLowerCase()) });
}
const CSI_NAMED: Record<string, string> = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end', '5~': 'pageup', '6~': 'pagedown', '3~': 'delete', '1~': 'home', '4~': 'end', P: 'f1', Q: 'f2', R: 'f3', S: 'f4', '15~': 'f5', '17~': 'f6', '18~': 'f7', '19~': 'f8', '20~': 'f9', '21~': 'f10', '23~': 'f11', '24~': 'f12' };
const modsFrom = (n: number) => { const m = Math.max(0, n - 1); return { shift: !!(m & 1), alt: !!(m & 2), ctrl: !!(m & 4), meta: !!(m & 8) }; };
/** One key from raw bytes. Undefined for anything it cannot read (which is then not a shortcut). */
export function decodeRaw(seq: string): KeyStep | undefined {
  if (!seq) return undefined;
  if (seq === '\r' || seq === '\n') return blank('enter'); if (seq === '\t') return blank('tab'); if (seq === '\x1b[Z') return blank('tab', { shift: true }); if (seq === '\x7f' || seq === '\b') return blank('backspace'); if (seq === '\x1b') return blank('esc'); if (seq === ' ') return blank('space');
  let m = /^\x1b\[(\d+)(?:;(\d+))?u$/.exec(seq); // CSI u: ESC [ code ; mods u
  if (m) { const code = Number(m[1]); const mods = modsFrom(Number(m[2] ?? 1)); const key = code === 13 ? 'enter' : code === 27 ? 'esc' : code === 9 ? 'tab' : code === 127 ? 'backspace' : code === 32 ? 'space' : String.fromCodePoint(code); return blank(mods.ctrl || mods.alt ? key.toLowerCase() : key, mods); }
  m = /^\x1b\[(?:1;(\d+))?([ABCDHFPQRS])$/.exec(seq) ?? /^\x1bO([PQRSHF])$/.exec(seq) as RegExpExecArray | null;
  if (m) { const last = m[2] ?? m[1]!; const mods = m[2] ? modsFrom(Number(m[1] ?? 1)) : {}; return blank(CSI_NAMED[last]!, mods); }
  m = /^\x1b\[(\d+)(?:;(\d+))?~$/.exec(seq); if (m) { const name = CSI_NAMED[`${m[1]}~`]; return name ? blank(name, modsFrom(Number(m[2] ?? 1))) : undefined; }
  if (seq.length === 2 && seq[0] === '\x1b') { const inner = decodeRaw(seq[1]!); return inner ? { ...inner, alt: true } : undefined; } // ESC-prefixed: alt
  if (seq.length === 1) { const c = seq.charCodeAt(0); if (c >= 1 && c <= 26) return blank(String.fromCharCode(c + 96), { ctrl: true }); if (c >= 32) return blank(seq); }
  if ([...seq].length === 1) return blank(seq); return undefined;
}
