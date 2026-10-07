import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { t } from '../i18n/index.js';
/** The first tabbable thing on the page: it jumps to <main>. */
export const SkipLink = (): React.JSX.Element => <a href="#main" className="cc-skip" onClick={(e) => { const m = document.getElementById('main'); if (m) { e.preventDefault(); m.setAttribute('tabindex', '-1'); m.focus(); } }}>{t('a11y.skip')}</a>;
/** When `open` turns false, focus goes back to the element that had it when it turned true. */
export function useFocusReturn(open: boolean): void { const back = useRef<Element | null>(null); useLayoutEffect(() => { if (open) back.current = document.activeElement; else { (back.current as HTMLElement | null)?.focus?.(); back.current = null; } }, [open]); }
const FOCUSABLE = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
/** Keeps Tab inside, and puts focus on the first control when it appears. */
export function FocusTrap({ children, active = true }: { children: React.ReactNode; active?: boolean }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null); useEffect(() => { if (active) (ref.current?.querySelector<HTMLElement>(FOCUSABLE) ?? ref.current)?.focus(); }, [active]);
  return <div ref={ref} tabIndex={-1} onKeyDown={(e) => { if (!active || e.key !== 'Tab') return; const els = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((x) => !x.hasAttribute('disabled')); if (!els.length) { e.preventDefault(); return; } const first = els[0]!; const last = els[els.length - 1]!; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }}>{children}</div>;
}
/** Arrow keys move between items (one tab stop for the group). */
export function useRoving(count: number, o: { horizontal?: boolean } = {}): { index: number; props(i: number): { tabIndex: number; onKeyDown(e: React.KeyboardEvent): void; ref(el: HTMLElement | null): void } } {
  const [index, setIndex] = React.useState(0); const els = useRef<(HTMLElement | null)[]>([]);
  return { index, props: (i) => ({ tabIndex: i === index ? 0 : -1, ref: (el) => { els.current[i] = el; }, onKeyDown: (e) => { const next = e.key === (o.horizontal ? 'ArrowRight' : 'ArrowDown') ? (i + 1) % count : e.key === (o.horizontal ? 'ArrowLeft' : 'ArrowUp') ? (i - 1 + count) % count : e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : -1; if (next < 0) return; e.preventDefault(); setIndex(next); els.current[next]?.focus(); } }) };
}
