/** Prompt editing as pure functions on (text, cursor). The cursor is an index into the string between characters. */
export interface Ed { text: string; cursor: number }

const prevCp = (s: string, i: number) => { if (i <= 0) return 0; const c = s.charCodeAt(i - 1); return c >= 0xdc00 && c <= 0xdfff && i >= 2 ? i - 2 : i - 1; };
const nextCp = (s: string, i: number) => { if (i >= s.length) return s.length; const c = s.charCodeAt(i); return c >= 0xd800 && c <= 0xdbff && i + 1 < s.length ? i + 2 : i + 1; };

export const insert = (e: Ed, s: string): Ed => ({ text: e.text.slice(0, e.cursor) + s + e.text.slice(e.cursor), cursor: e.cursor + s.length });
export const backspace = (e: Ed): Ed => { const p = prevCp(e.text, e.cursor); return { text: e.text.slice(0, p) + e.text.slice(e.cursor), cursor: p }; };
export const del = (e: Ed): Ed => ({ text: e.text.slice(0, e.cursor) + e.text.slice(nextCp(e.text, e.cursor)), cursor: e.cursor });
export const left = (e: Ed): Ed => ({ ...e, cursor: prevCp(e.text, e.cursor) });
export const right = (e: Ed): Ed => ({ ...e, cursor: nextCp(e.text, e.cursor) });
export const lineStart = (e: Ed): Ed => ({ ...e, cursor: e.text.lastIndexOf('\n', e.cursor - 1) + 1 });
export const lineEnd = (e: Ed): Ed => { const i = e.text.indexOf('\n', e.cursor); return { ...e, cursor: i < 0 ? e.text.length : i }; };
export const killToLineStart = (e: Ed): Ed => { const s = lineStart(e).cursor; return { text: e.text.slice(0, s) + e.text.slice(e.cursor), cursor: s }; };
export const killToLineEnd = (e: Ed): Ed => ({ text: e.text.slice(0, e.cursor) + e.text.slice(lineEnd(e).cursor), cursor: e.cursor });
export const wordLeft = (e: Ed): Ed => { let i = e.cursor; while (i > 0 && /\s/.test(e.text[i - 1]!)) i--; while (i > 0 && !/\s/.test(e.text[i - 1]!)) i--; return { ...e, cursor: i }; };
export const wordRight = (e: Ed): Ed => { let i = e.cursor; while (i < e.text.length && /\s/.test(e.text[i]!)) i++; while (i < e.text.length && !/\s/.test(e.text[i]!)) i++; return { ...e, cursor: i }; };
export const killWordLeft = (e: Ed): Ed => { const w = wordLeft(e).cursor; return { text: e.text.slice(0, w) + e.text.slice(e.cursor), cursor: w }; };
export const killWordRight = (e: Ed): Ed => { const w = wordRight(e).cursor; return { text: e.text.slice(0, e.cursor) + e.text.slice(w), cursor: e.cursor }; };
/** Selection: an anchor index; the selected text is between the anchor and the cursor. */
export const selRange = (text: string, cursor: number, anchor: number | undefined): [number, number] | undefined => {
  if (anchor === undefined || anchor === cursor) return undefined; const a = Math.min(anchor, text.length);
  return a === cursor ? undefined : [Math.min(a, cursor), Math.max(a, cursor)];
};
export const selectedText = (text: string, cursor: number, anchor: number | undefined): string => { const r = selRange(text, cursor, anchor); return r ? text.slice(r[0], r[1]) : ''; };
export const removeRange = (e: Ed, lo: number, hi: number): Ed => ({ text: e.text.slice(0, lo) + e.text.slice(hi), cursor: lo });
/** The `@file` word being typed at the cursor: from an `@` that starts a word, up to the cursor. */
export interface Mention { start: number; end: number; query: string }
export function mentionAt(text: string, cursor: number): Mention | undefined {
  const before = text.slice(0, cursor); const m = /(^|\s)@([^\s@]*)$/.exec(before); if (!m) return undefined;
  const start = before.length - m[2]!.length - 1; let end = cursor; while (end < text.length && !/\s/.test(text[end]!)) end++; // the rest of the word after the cursor is replaced too
  return { start, end, query: m[2]! };
}
/** Put the chosen path in place of the word being typed, with a space after it, and the cursor after that. */
export function completeMention(e: Ed, m: Mention, path: string): Ed { const ins = `@${path} `; return { text: e.text.slice(0, m.start) + ins + e.text.slice(m.end).replace(/^ /, ''), cursor: m.start + ins.length }; }
export const isSingleLine = (e: Ed) => !e.text.includes('\n');

/** Move the cursor one visual line up/down in a multi-line buffer, keeping the column when possible. Returns null at the edges. */
export function moveVertical(e: Ed, dir: -1 | 1): Ed | null {
  const starts = [0]; for (let i = 0; i < e.text.length; i++) if (e.text[i] === '\n') starts.push(i + 1);
  let row = starts.length - 1; while (starts[row]! > e.cursor) row--;
  const col = e.cursor - starts[row]!; const target = row + dir;
  if (target < 0 || target >= starts.length) return null;
  const end = target + 1 < starts.length ? starts[target + 1]! - 1 : e.text.length;
  return { ...e, cursor: Math.min(starts[target]! + col, end) };
}

export interface InputLayout { rows: string[]; row: number; col: number; /** Index in the text where each row starts. */ starts: number[] }
/** Lay the buffer out in rows of at most `width` columns (hard wrap) and find the cursor's row and column. */
export function layoutInput(e: Ed, width: number): InputLayout {
  const w = Math.max(4, width);
  const rows: string[] = []; const starts: number[] = []; let row = 0, col = 0; let idx = 0;
  const parts = e.text.split('\n');
  parts.forEach((part, pi) => {
    const chars = [...part];
    let offset = 0;
    do {
      const chunk = chars.slice(offset, offset + w);
      const start = idx; const len = chunk.join('').length;
      if (e.cursor >= start && e.cursor <= start + len && (e.cursor < start + len || offset + w >= chars.length)) { row = rows.length; col = [...e.text.slice(start, e.cursor)].length; }
      starts.push(start); rows.push(chunk.join('')); idx += len; offset += w;
    } while (offset < chars.length);
    idx += 1; // the newline
    void pi;
  });
  return { rows, row, col, starts };
}
