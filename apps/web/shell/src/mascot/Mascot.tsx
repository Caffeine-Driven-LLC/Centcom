import React, { useEffect, useMemo, useRef } from 'react';
import { useReducedMotion } from '../a11y/motion.js';
import { Catalog, paletteFor, type Sprite } from './catalog.js';
import { MascotScheduler, StateGate } from './scheduler.js';
import { isStartling, stateToAnimation } from './statemap.js';

export const SCALES = [2, 3, 4, 6] as const; export type Scale = (typeof SCALES)[number];
let sched = new MascotScheduler(); let catalog = new Catalog((u) => fetch(u)); let n = 0;
/** For tests and for a page that serves the data from elsewhere. */
export const configureMascot = (o: { scheduler?: MascotScheduler; catalog?: Catalog }): void => { if (o.scheduler) sched = o.scheduler; if (o.catalog) catalog = o.catalog; };
export const scheduler = (): MascotScheduler => sched;
/** Draws one frame at an integer scale and the device's pixel ratio, with no smoothing. */
export function drawFrame(canvas: HTMLCanvasElement, sprite: Sprite, frame: number, scale: number, dpr: number, pal: Record<string, string>): void {
  const px = Math.max(1, Math.round(scale * dpr)); canvas.width = sprite.w * px; canvas.height = sprite.h * px; canvas.style.width = `${sprite.w * scale}px`; canvas.style.height = `${sprite.h * scale}px`; const g = canvas.getContext('2d'); if (!g) return; g.imageSmoothingEnabled = false; g.clearRect(0, 0, canvas.width, canvas.height);
  const rows = sprite.frames[frame % sprite.frames.length]!.rows; for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y]!.length; x++) { const c = pal[rows[y]![x]!]; if (rows[y]![x] !== '.' && c) { g.fillStyle = c; g.fillRect(x * px, y * px, px, px); } }
}
/** Cento on a canvas for a product state. The canvas is hidden from assistive tech and the component has no text: say what Cento is doing next to it. */
export function Mascot({ state, colour = 'violet', scale = 3, onUnknown }: { state: string; colour?: string; scale?: Scale; onUnknown?: () => void }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null); const reduced = useReducedMotion(); const id = useMemo(() => `m${++n}`, []); const animate = useRef(false); const sprite = useRef<Sprite | undefined>(undefined); const pal = useRef<Record<string, string>>({}); const frame = useRef(0); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    let dead = false; const cv = ref.current; if (!cv) return; const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const draw = (): void => { if (sprite.current && cv) drawFrame(cv, sprite.current, frame.current, scale, dpr, pal.current); };
    const loop = (): void => { clearTimeout(timer.current); if (dead || !animate.current || reduced || !sprite.current) return; const f = sprite.current.frames[frame.current % sprite.current.frames.length]!; timer.current = setTimeout(() => { frame.current = (frame.current + 1) % sprite.current!.frames.length; draw(); loop(); }, f.d); };
    const gate = new StateGate({ now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as never) }, (s) => { const a = stateToAnimation(s); if (!a.known) onUnknown?.(); if (reduced && isStartling(s, a.name)) return; void catalog.sprite(a.name).then(async (sp) => { if (dead || !sp) return; const ix = await catalog.index(); pal.current = paletteFor(ix, colour); sprite.current = sp; frame.current = 0; draw(); loop(); }).catch(() => undefined); });
    const off = sched.register(id, (a) => { animate.current = a; if (a) loop(); else clearTimeout(timer.current); });
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((es) => { for (const e of es) sched.setVisible(id, e.isIntersecting); }) : undefined; io?.observe(cv);
    const vis = (): void => sched.setPageHidden(document.visibilityState === 'hidden'); document.addEventListener('visibilitychange', vis); gate.request(state);
    return () => { dead = true; clearTimeout(timer.current); gate.dispose(); off(); io?.disconnect(); document.removeEventListener('visibilitychange', vis); };
  }, [id, state, colour, scale, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} aria-hidden="true" className="cc-mascot-canvas" data-mascot-state={state} />;
}
