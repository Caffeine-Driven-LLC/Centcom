import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Box, measureElement, type DOMElement } from 'ink';

/** Clickable regions. Ink has no mouse events, so a region registers its element and the app hit-tests a press against each one's measured box; the one drawn last (on top) wins. */
export interface ClickRegistry { add(el: () => DOMElement | null, fn: () => void): () => void; hit(col: number, row: number): boolean }
export function createClickRegistry(): ClickRegistry {
  const regions = new Set<{ el: () => DOMElement | null; fn: () => void }>();
  return {
    add(el, fn) { const r = { el, fn }; regions.add(r); return () => { regions.delete(r); }; },
    /** `col` and `row` are 1-based terminal cells (as the mouse reports them); the app fills the screen from its top-left corner. */
    hit(col, row) {
      const x = col - 1, y = row - 1;
      for (const r of [...regions].reverse()) {
        const node = r.el(); if (!node) continue; let m; try { m = measureElement(node); } catch { continue; }
        if (m.width > 0 && m.height > 0 && x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height) { r.fn(); return true; }
      }
      return false;
    },
  };
}
export const ClickContext = createContext<ClickRegistry | undefined>(undefined);

/** A box that reacts to a left click. Without a registry above it (tests, print) it is just a box. */
export function Clickable({ onClick, children, ...box }: { onClick: () => void; children: React.ReactNode } & Omit<React.ComponentProps<typeof Box>, 'children' | 'ref'>) {
  const reg = useContext(ClickContext); const ref = useRef<DOMElement>(null); const fn = useRef(onClick); fn.current = onClick;
  useEffect(() => reg?.add(() => ref.current, () => fn.current()), [reg]);
  return <Box ref={ref} {...box}>{children}</Box>;
}

/** The left-button presses in a chunk of raw terminal input (SGR mouse reports). Motion, drags, the wheel and clicks with shift, alt or ctrl held are not clicks. */
export function clicksIn(data: string): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = [];
  for (const m of data.matchAll(/\x1b\[<(\d+);(\d+);(\d+)M/g)) { const b = Number(m[1]); if ((b & 3) === 0 && !(b & (4 | 8 | 16 | 32 | 64))) out.push({ col: Number(m[2]), row: Number(m[3]) }); }
  return out;
}
