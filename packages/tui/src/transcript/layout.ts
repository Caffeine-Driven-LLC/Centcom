/** Turns transcript items into rows, remembering each block's rows for its width, so scrolling and streaming only build what changed and what is on screen. */
import type { Item } from '../state/model.js';
import { itemLines } from '../util/transcript.js';
import { sp, type Line } from '../util/text.js';

export const MAX_BLOCKS = 5000;
interface Measured { width: number; lines: Line[] }
export interface Block { item: Item; start: number; height: number; gap: boolean }
/** Items are replaced (never changed in place) when they change, so the item object is its own revision. */
export class TranscriptLayout {
  private cache = new WeakMap<Item, Measured>(); measures = 0; hits = 0; private blocks: Block[] = []; private width = 0; private hidden = 0; total = 0;
  private linesOf(it: Item, width: number): Line[] { const c = this.cache.get(it); if (c && c.width === width) { this.hits++; return c.lines; } this.measures++; const lines = itemLines(it, width); this.cache.set(it, { width, lines }); return lines; }
  /** Lay out `items` at `width`. Only items not seen at this width are measured. */
  update(items: Item[], width: number, compact = false): this {
    this.width = width; this.hidden = Math.max(0, items.length - MAX_BLOCKS); const shown = this.hidden ? items.slice(this.hidden) : items; const out: Block[] = []; let row = this.hidden ? 2 : 0; let prev: Item['kind'] | undefined;
    for (const it of shown) { const grouped = (prev === 'tool' && (it.kind === 'tool' || it.kind === 'thinking')) || (prev === 'thinking' && (it.kind === 'tool' || it.kind === 'assistant')); const gap = !!prev && !grouped && (!compact || it.kind === 'user'); /* compact: a blank row only before your own messages */ if (gap) row++; const h = this.linesOf(it, width).length; out.push({ item: it, start: row, height: h, gap }); row += h; prev = it.kind; }
    this.blocks = out; this.total = row; return this;
  }
  /** Rows [start, end), built only for the blocks that overlap. */
  slice(start: number, end: number): Line[] {
    const rows: Line[] = []; if (this.hidden && start < 2) { rows.push([sp(`⋯ ${this.hidden.toLocaleString('en-US')} earlier messages`, { c: 'text.muted' })], []); }
    let i = this.findBlock(start); for (; i < this.blocks.length; i++) { const b = this.blocks[i]!; if (b.start >= end) break; if (b.gap && b.start - 1 >= start && b.start - 1 < end) rows.push([]); const lines = this.linesOf(b.item, this.width); for (let r = 0; r < lines.length; r++) { const at = b.start + r; if (at >= start && at < end) rows.push(lines[r]!); } }
    return rows.slice(0, end - start);
  }
  /** The first block whose rows reach `row`. */
  findBlock(row: number): number { let lo = 0, hi = this.blocks.length - 1, ans = this.blocks.length; while (lo <= hi) { const mid = (lo + hi) >> 1; if (this.blocks[mid]!.start + this.blocks[mid]!.height > row) { ans = mid; hi = mid - 1; } else lo = mid + 1; } return Math.min(ans, Math.max(0, this.blocks.length - 1)); }
  /** Which item and line sit at `row`, to keep it in place across a resize. */
  anchorAt(row: number): { id: string; offset: number } | undefined { const b = this.blocks[this.findBlock(row)]; return b ? { id: b.item.id, offset: Math.max(0, row - b.start) } : undefined; }
  rowOf(a: { id: string; offset: number }): number | undefined { const b = this.blocks.find((x) => x.item.id === a.id); return b ? b.start + Math.min(a.offset, b.height - 1) : undefined; }
}
