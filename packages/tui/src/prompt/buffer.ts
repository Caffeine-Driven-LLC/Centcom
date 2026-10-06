/** The text being typed, edited by whole characters as a person sees them (a family emoji is one unit). The cursor is a UTF-16 offset. */
const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' }); const words = new Intl.Segmenter(undefined, { granularity: 'word' });
const clusters = (s: string): { at: number; text: string }[] => [...seg.segment(s)].map((x) => ({ at: x.index, text: x.segment }));
/** Display width of one cluster: 2 for wide characters and emoji, 0 for combining marks alone, else 1. */
export function clusterWidth(c: string): number { if (/\p{Extended_Pictographic}/u.test(c) || /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/u.test(c) || /\p{Emoji_Presentation}/u.test(c)) return 2; if (/^\p{M}+$/u.test(c)) return 0; return 1; }
export const textWidth = (s: string): number => clusters(s).reduce((n, c) => n + clusterWidth(c.text), 0);

export class TextBuffer {
  text = ''; cursor = 0;
  constructor(text = '') { this.text = text; this.cursor = text.length; }
  insert(s: string): void { this.text = this.text.slice(0, this.cursor) + s + this.text.slice(this.cursor); this.cursor += s.length; }
  /** Deletes the character before the cursor (a whole cluster). */
  backspace(): void { const p = this.prev(this.cursor); this.text = this.text.slice(0, p) + this.text.slice(this.cursor); this.cursor = p; }
  deleteForward(): void { const n = this.next(this.cursor); this.text = this.text.slice(0, this.cursor) + this.text.slice(n); }
  private prev(i: number): number { let p = 0; for (const c of clusters(this.text)) { if (c.at >= i) break; p = c.at; } return p; }
  private next(i: number): number { for (const c of clusters(this.text)) if (c.at >= i) return c.at + c.text.length > i && c.at === i ? c.at + c.text.length : c.at; return this.text.length; }
  left(): void { this.cursor = this.prev(this.cursor); } right(): void { this.cursor = this.next(this.cursor); }
  /** Start and end of the line the cursor is on. */
  lineStart(): void { this.cursor = this.text.lastIndexOf('\n', this.cursor - 1) + 1; } lineEnd(): void { const i = this.text.indexOf('\n', this.cursor); this.cursor = i < 0 ? this.text.length : i; }
  /** Alt+b / alt+f: to the start of the previous word, or the end of the next. */
  moveWord(dir: -1 | 1): void {
    const segs = [...words.segment(this.text)].filter((s) => s.isWordLike);
    if (dir < 0) { let p = 0; for (const s of segs) { if (s.index < this.cursor) p = s.index; else break; } this.cursor = p; } else { const s = segs.find((x) => x.index + x.segment.length > this.cursor); this.cursor = s ? s.index + s.segment.length : this.text.length; }
  }
  /** Ctrl+w: deletes back to the start of the word. */
  deleteWord(): void { const end = this.cursor; this.moveWord(-1); this.text = this.text.slice(0, this.cursor) + this.text.slice(end); }
  /** Ctrl+u: deletes to the start of the line. */
  killToLineStart(): void { const end = this.cursor; this.lineStart(); this.text = this.text.slice(0, this.cursor) + this.text.slice(end); }
  /** The text cut into rows of at most `width` columns (wide characters count 2), keeping explicit newlines. */
  lines(width: number): string[] {
    const out: string[] = []; for (const para of this.text.split('\n')) { let row = ''; let w = 0; for (const c of clusters(para)) { const cw = clusterWidth(c.text); if (w + cw > width && row) { out.push(row); row = ''; w = 0; } row += c.text; w += cw; } out.push(row); } return out;
  }
  /** Where the cursor is drawn: row and column (in terminal columns) for the given width. */
  cursorPos(width: number): { row: number; col: number } {
    const before = new TextBuffer(this.text.slice(0, this.cursor)); const rows = before.lines(width); const last = rows[rows.length - 1] ?? ''; return { row: rows.length - 1, col: textWidth(last) };
  }
}
