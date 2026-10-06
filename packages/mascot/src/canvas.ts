import type { Pixels } from './sprite.js';

/** A growable pixel canvas that can be cropped to its content. */
export class Canvas {
  private px = new Map<string, string>();
  set(r: number, c: number, ch: string) { if (ch !== '.') this.px.set(`${r},${c}`, ch); }
  blitPixels(p: Pixels, dr: number, dc: number) {
    for (const [k, ch] of p) { const [r, c] = k.split(',').map(Number) as [number, number]; this.set(r + dr, c + dc, ch); }
  }
  blitRows(rows: readonly string[], dr: number, dc: number) {
    rows.forEach((row, r) => [...row].forEach((ch, c) => this.set(r + dr, c + dc, ch)));
  }
  bounds(): { r0: number; c0: number; r1: number; c1: number } | null {
    let r0 = Infinity, c0 = Infinity, r1 = -Infinity, c1 = -Infinity;
    for (const k of this.px.keys()) { const [r, c] = k.split(',').map(Number) as [number, number]; r0 = Math.min(r0, r); c0 = Math.min(c0, c); r1 = Math.max(r1, r); c1 = Math.max(c1, c); }
    return r0 === Infinity ? null : { r0, c0, r1, c1 };
  }
  /** Render into rows over an explicit window (so every frame of an animation shares the same size). */
  toRows(win: { r0: number; c0: number; r1: number; c1: number }): string[] {
    const rows: string[] = [];
    for (let r = win.r0; r <= win.r1; r++) {
      let line = '';
      for (let c = win.c0; c <= win.c1; c++) line += this.px.get(`${r},${c}`) ?? '.';
      rows.push(line);
    }
    return rows;
  }
}

export interface Window { r0: number; c0: number; r1: number; c1: number }
export function unionWindow(ws: (Window | null)[]): Window {
  const ok = ws.filter((w): w is Window => w !== null);
  return { r0: Math.min(...ok.map((w) => w.r0)), c0: Math.min(...ok.map((w) => w.c0)), r1: Math.max(...ok.map((w) => w.r1)), c1: Math.max(...ok.map((w) => w.c1)) };
}
