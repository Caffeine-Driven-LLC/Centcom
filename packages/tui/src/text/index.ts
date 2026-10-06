/** Text helpers every component uses: widths in terminal columns, wrapping, cutting, and cleaning text before it reaches the screen. */
const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/u;
/** Columns one grapheme takes: 2 for wide characters and emoji, 0 for lone combining marks, otherwise 1. */
function clusterWidth(c: string): number { if (/^\p{M}+$/u.test(c)) return 0; if (/\p{Extended_Pictographic}|\p{Emoji_Presentation}/u.test(c) || WIDE.test(c)) return 2; return 1; }
export const stringWidth = (s: string): number => { let w = 0; for (const x of seg.segment(s)) w += clusterWidth(x.segment); return w; };
/** Removes every control character (ESC, C1 and the rest) except newline; tabs become 4 spaces. A screen never sees what the text tried to do. */
export function sanitizeForTerminal(s: string): string { return s.replace(/\t/g, '    ').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, ''); }
/** Cuts to `width` columns, ending with the ellipsis when something was cut. */
export function truncate(s: string, width: number, ellipsis = '…'): string {
  if (width <= 0) return ''; if (stringWidth(s) <= width) return s; const room = Math.max(0, width - stringWidth(ellipsis)); let out = ''; let w = 0;
  for (const x of seg.segment(s)) { const cw = clusterWidth(x.segment); if (w + cw > room) break; out += x.segment; w += cw; } return out + (room >= 0 ? ellipsis : '');
}
/** Breaks text into rows of at most `width` columns: at spaces when it can, in the middle of a long word when it must. Newlines are kept. */
export function wrapText(text: string, width: number): string[] {
  const w = Math.max(1, width); const rows: string[] = [];
  for (const para of sanitizeForTerminal(text).split('\n')) {
    let row = ''; let rw = 0; const flush = () => { rows.push(row.replace(/\s+$/, '')); row = ''; rw = 0; };
    for (const word of para.split(/(?<= )/)) {
      const ww = stringWidth(word);
      if (rw + stringWidth(word.replace(/\s+$/, '')) <= w) { row += word; rw += ww; continue; }
      if (row) flush();
      if (stringWidth(word.replace(/\s+$/, '')) <= w) { row = word; rw = ww; continue; }
      for (const x of seg.segment(word)) { const cw = clusterWidth(x.segment); if (rw + cw > w) flush(); row += x.segment; rw += cw; }
    }
    flush();
  }
  return rows;
}
