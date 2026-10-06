/** A minimal JSON patcher: finds where each member of an object sits in the text, so one member can be replaced, inserted or removed while every other byte of the file stays as it was. It reads JSON (no comments) and returns undefined for anything that is not. */
export interface Member { key: string; keyStart: number; valStart: number; valEnd: number }
export interface ObjectSpan { open: number; close: number; members: Member[] }

export function scanObject(text: string, at: number): ObjectSpan | undefined {
  let i = at; const ws = () => { while (i < text.length && /\s/.test(text[i]!)) i++; };
  const str = (): string | undefined => { const s = i; if (text[i] !== '"') return undefined; i++; while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; i++; } if (i >= text.length) return undefined; i++; try { return JSON.parse(text.slice(s, i)) as string; } catch { return undefined; } };
  const skip = (): boolean => { // one value of any kind
    ws(); const c = text[i];
    if (c === '"') return str() !== undefined;
    if (c === '{') { const o = scanObject(text, i); if (!o) return false; i = o.close + 1; return true; }
    if (c === '[') { i++; ws(); if (text[i] === ']') { i++; return true; } for (;;) { if (!skip()) return false; ws(); if (text[i] === ',') { i++; continue; } if (text[i] === ']') { i++; return true; } return false; } }
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 40)); if (!m) return false; i += m[0].length; return true;
  };
  if (text[i] !== '{') return undefined; const open = i; i++; const members: Member[] = []; ws(); if (text[i] === '}') return { open, close: i, members };
  for (;;) { ws(); const keyStart = i; const key = str(); if (key === undefined) return undefined; ws(); if (text[i] !== ':') return undefined; i++; ws(); const valStart = i; if (!skip()) return undefined; const valEnd = i; members.push({ key, keyStart, valStart, valEnd }); ws(); if (text[i] === ',') { i++; continue; } if (text[i] === '}') return { open, close: i, members }; return undefined; }
}
const lineIndent = (text: string, pos: number) => { const s = text.lastIndexOf('\n', pos - 1) + 1; return /^[ \t]*/.exec(text.slice(s, pos))![0]; };
export const detectUnit = (text: string): string => { const m = /\n([ \t]+)"/.exec(text); return m ? m[1]! : '  '; };
export const detectEol = (text: string): string => (/\r\n/.test(text) ? '\r\n' : '\n');
/** `value` as JSON text indented so that it sits as a member of an object whose own line has indent `base`. */
export function render(value: unknown, base: string, unit: string, eol: string): string { return JSON.stringify(value, null, unit).split('\n').join(eol + base); }

/** Set (or, with `value === undefined`, remove) one member of the object that starts at `objAt`. Returns the new text, or undefined if the object cannot be read. */
export function setMember(text: string, objAt: number, key: string, value: unknown): string | undefined {
  const o = scanObject(text, objAt); if (!o) return undefined; const eol = detectEol(text); const unit = detectUnit(text); const at = o.members.findIndex((m) => m.key === key); const objIndent = lineIndent(text, o.open); const childIndent = o.members.length ? lineIndent(text, o.members[0]!.keyStart) : objIndent + unit;
  if (at >= 0) {
    const m = o.members[at]!;
    if (value !== undefined) return text.slice(0, m.valStart) + render(value, childIndent, unit, eol) + text.slice(m.valEnd);
    if (o.members.length === 1) return text.slice(0, o.open + 1) + text.slice(o.close);
    if (at > 0) return text.slice(0, o.members[at - 1]!.valEnd) + text.slice(m.valEnd);
    return text.slice(0, m.keyStart) + text.slice(o.members[1]!.keyStart);
  }
  if (value === undefined) return text;
  const member = `${JSON.stringify(key)}: ${render(value, childIndent, unit, eol)}`;
  if (!o.members.length) return text.slice(0, o.open + 1) + eol + childIndent + member + eol + objIndent + text.slice(o.close);
  const last = o.members[o.members.length - 1]!; return text.slice(0, last.valEnd) + ',' + eol + childIndent + member + text.slice(last.valEnd);
}
/** The value text of `key` in the top-level object, and where it starts. */
export function memberAt(text: string, objAt: number, key: string): Member | undefined { return scanObject(text, objAt)?.members.find((m) => m.key === key); }
export const topAt = (text: string): number => text.search(/\S/);
