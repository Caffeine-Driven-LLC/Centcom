/**
 * Rich text as data: a Line is a list of styled spans. Components build Lines, `wrapLine` fits them to a width,
 * and Ink renders them. Pure and testable, which is what makes scrolling and layout exact.
 */
import type { SemanticToken } from '@centcom/theme';

export type Colour = SemanticToken | `#${string}`;
export interface Span { t: string; c?: Colour; bg?: Colour; b?: boolean; d?: boolean; i?: boolean; u?: boolean; /** Reverse video: how a changed word stands out without colour. */ r?: boolean }
export type Line = Span[];

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;
const ZERO = /[̀-ͯ​-‏︀-️]/;

/** Terminal cell width of one character (0, 1 or 2). */
export function cellWidth(ch: string): number { return ZERO.test(ch) ? 0 : WIDE.test(ch) ? 2 : 1; }
export function textWidth(s: string): number { let w = 0; for (const ch of s) w += cellWidth(ch); return w; }
export function lineWidth(l: Line): number { return l.reduce((n, s) => n + textWidth(s.t), 0); }

export const sp = (t: string, o: Omit<Span, 't'> = {}): Span => ({ t, ...o });
export const plain = (t: string, o: Omit<Span, 't'> = {}): Line => [sp(t, o)];

/** Cut a string to at most `width` cells, appending an ellipsis when it was cut. */
export function truncate(s: string, width: number): string {
  if (width <= 0) return '';
  if (textWidth(s) <= width) return s;
  let out = ''; let w = 0;
  for (const ch of s) { const cw = cellWidth(ch); if (w + cw > width - 1) break; out += ch; w += cw; }
  return out + '…';
}

/** Middle-truncate paths: src/…/client.ts */
export function truncateMiddle(s: string, width: number): string {
  if (textWidth(s) <= width) return s;
  if (width < 5) return truncate(s, width);
  const keep = width - 1; const head = Math.ceil(keep / 2); const tail = Math.floor(keep / 2);
  return [...s].slice(0, head).join('') + '…' + [...s].slice(-tail).join('');
}

/** Wrap one Line to `width` cells, breaking at spaces when possible, keeping span styles. Always returns at least one line. */
export function wrapLine(line: Line, width: number, indent: Line = []): Line[] {
  if (width < 4) width = 4;
  const out: Line[] = [];
  let cur: Line = []; let w = 0;
  const indentW = lineWidth(indent);
  const flush = (hard = false) => { out.push(cur); cur = out.length > 0 ? [...indent] : []; w = indentW; void hard; };
  type Tok = { s: Span; text: string; space: boolean };
  const toks: Tok[] = [];
  for (const s of line) for (const part of s.t.split(/(\s+)/)) if (part) toks.push({ s, text: part, space: /^\s+$/.test(part) });
  for (const tk of toks) {
    const tw = textWidth(tk.text);
    if (tk.text.includes('\n')) { // explicit newlines inside a span
      const segs = tk.text.split('\n');
      segs.forEach((seg, i) => { if (seg) { cur.push({ ...tk.s, t: seg }); w += textWidth(seg); } if (i < segs.length - 1) flush(); });
      continue;
    }
    if (tk.space) { if (w === indentW && cur.length === 0) continue; if (w + tw > width) { flush(); continue; } cur.push({ ...tk.s, t: tk.text }); w += tw; continue; }
    if (w + tw <= width) { cur.push({ ...tk.s, t: tk.text }); w += tw; continue; }
    if (tw <= width - indentW && w > indentW) { // move the whole word to the next line, dropping trailing spaces
      while (cur.length && /^\s+$/.test(cur[cur.length - 1]!.t)) cur.pop();
      flush(); cur.push({ ...tk.s, t: tk.text }); w += tw; continue;
    }
    // a word longer than a line: hard-break it
    let chunk = '';
    for (const ch of tk.text) {
      const cw = cellWidth(ch);
      if (w + cw > width) { if (chunk) cur.push({ ...tk.s, t: chunk }); chunk = ''; flush(true); }
      chunk += ch; w += cw;
    }
    if (chunk) cur.push({ ...tk.s, t: chunk });
  }
  while (cur.length && /^\s+$/.test(cur[cur.length - 1]!.t) && out.length) cur.pop();
  out.push(cur);
  return out;
}

export function wrapLines(lines: Line[], width: number, indent: Line = []): Line[] { return lines.flatMap((l) => (l.length === 0 ? [[]] : wrapLine(l, width, indent))); }

/** Pad/clip a line to exactly `width` cells (for boxes). */
export function fit(line: Line, width: number): Line {
  const w = lineWidth(line);
  if (w === width) return line;
  if (w < width) return [...line, sp(' '.repeat(width - w))];
  const out: Line = []; let used = 0;
  for (const s of line) {
    let t = '';
    for (const ch of s.t) { const cw = cellWidth(ch); if (used + cw > width) break; t += ch; used += cw; }
    if (t) out.push({ ...s, t });
    if (used >= width) break;
  }
  return out;
}

export function formatTokens(n: number): string { return n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + 'k' : String(n); }
export function formatElapsed(ms: number): string { const s = Math.floor(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; }
export function formatCost(usd: number): string { return usd < 0.01 ? '<$0.01' : '$' + usd.toFixed(2); }

/** "2h 41m", "3d 4h", "12m" or "now": time until an epoch-seconds reset. */
export function formatReset(resetsAtSec: number, nowMs = Date.now()): string {
  const s = Math.floor(resetsAtSec - nowMs / 1000); if (!resetsAtSec || s <= 60) return s <= 0 && resetsAtSec ? 'now' : '1m';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}
