/** A terminal screen from raw output: feeds bytes to an xterm headless emulator and reads rows and cells back. */
import xterm from '@xterm/headless';
import type { Terminal as XTerm } from '@xterm/headless';
const { Terminal } = xterm as unknown as { Terminal: new (o: Record<string, unknown>) => XTerm };

export interface Cell { ch: string; /** '#rrggbb' or undefined for the default colour */ fg?: string; bg?: string; bold: boolean; dim: boolean; italic: boolean; underline: boolean; inverse: boolean }

const cube = [0, 95, 135, 175, 215, 255];
const BASE16 = ['000000', 'cd0000', '00cd00', 'cdcd00', '0000ee', 'cd00cd', '00cdcd', 'e5e5e5', '7f7f7f', 'ff0000', '00ff00', 'ffff00', '5c5cff', 'ff00ff', '00ffff', 'ffffff'];
export function paletteHex(i: number): string {
  if (i < 16) return `#${BASE16[i]}`; if (i < 232) { const n = i - 16; return '#' + [cube[Math.floor(n / 36)]!, cube[Math.floor(n / 6) % 6]!, cube[n % 6]!].map((v) => v.toString(16).padStart(2, '0')).join(''); }
  const g = 8 + (i - 232) * 10; return '#' + g.toString(16).padStart(2, '0').repeat(3);
}
export class Screen {
  private term: XTerm; private pending = 0; private waiters: (() => void)[] = [];
  constructor(public cols = 100, public rows = 30) { this.term = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 1000 }); }
  /** Feed output; resolves when the emulator has parsed it. */
  write(data: string | Uint8Array): Promise<void> { this.pending++; return new Promise((res) => this.term.write(data, () => { this.pending--; res(); if (this.pending === 0) for (const w of this.waiters.splice(0)) w(); })); }
  idle(): Promise<void> { return this.pending === 0 ? Promise.resolve() : new Promise((r) => this.waiters.push(r)); }
  resize(cols: number, rows: number): void { this.cols = cols; this.rows = rows; this.term.resize(cols, rows); }
  /** The visible rows as plain text, trailing spaces removed. */
  screen(): string[] { const b = this.term.buffer.active; return Array.from({ length: this.rows }, (_, y) => b.getLine(b.viewportY + y)?.translateToString(true) ?? ''); }
  cells(): Cell[][] {
    const b = this.term.buffer.active; const out: Cell[][] = [];
    for (let y = 0; y < this.rows; y++) {
      const line = b.getLine(b.viewportY + y); const row: Cell[] = [];
      for (let x = 0; x < this.cols; x++) {
        const c = line?.getCell(x); if (!c) { row.push({ ch: ' ', bold: false, dim: false, italic: false, underline: false, inverse: false }); continue; }
        const color = (rgb: boolean, pal: boolean, v: number) => (rgb ? '#' + v.toString(16).padStart(6, '0') : pal ? paletteHex(v) : undefined);
        row.push({ ch: c.getChars() || ' ', fg: color(c.isFgRGB(), c.isFgPalette(), c.getFgColor()), bg: color(c.isBgRGB(), c.isBgPalette(), c.getBgColor()), bold: !!c.isBold(), dim: !!c.isDim(), italic: !!c.isItalic(), underline: !!c.isUnderline(), inverse: !!c.isInverse() });
      }
      out.push(row);
    }
    return out;
  }
  dispose(): void { this.term.dispose(); }
}
