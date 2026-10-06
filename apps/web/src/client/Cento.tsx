import { useEffect, useMemo, useRef, useState } from 'react';
import { MascotDriver, PAL_HEX, miniRows, type CentoColor, type MascotFrame, type MiniState } from '@centcom/mascot';

function paint(c: HTMLCanvasElement, rows: readonly string[], px: number) {
  const w = rows[0]?.length ?? 0; const h = rows.length;
  c.width = w * px; c.height = h * px; const g = c.getContext('2d')!; g.clearRect(0, 0, c.width, c.height);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const ch = rows[y]![x]!; if (ch !== '.' && PAL_HEX[ch]) { g.fillStyle = PAL_HEX[ch]!; g.fillRect(x * px, y * px, px, px); } }
}

export function Pixels({ rows, px, label }: { rows: readonly string[]; px: number; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) paint(ref.current, rows, px); }, [rows, px]);
  return <canvas ref={ref} className="pixels" role="img" aria-label={label ?? 'Cento'} style={{ imageRendering: 'pixelated' }} />;
}

/** The big animated Cento; `state` is the agent state name, mapped to a scene by the driver. */
export function Cento({ state, color, px = 5, reduced }: { state: string; color: CentoColor; px?: number; reduced: boolean }) {
  const driver = useMemo(() => new MascotDriver({ color, reducedMotion: reduced }), [color, reduced]);
  const [f, setF] = useState<MascotFrame>(() => driver.frame);
  useEffect(() => { driver.start(); const u = driver.subscribe(setF); return () => { u(); driver.stop(); }; }, [driver]);
  useEffect(() => { driver.setState(state); }, [driver, state]);
  return <Pixels rows={f.rows} px={px} label={`Cento is ${state.replace(/-/g, ' ')}`} />;
}

export function Mini({ state, color, busy, px = 4 }: { state: MiniState; color: CentoColor; busy: boolean; px?: number }) {
  const [t, setT] = useState(0);
  useEffect(() => { if (!busy) return; const i = setInterval(() => setT((x) => x + 1), 500); return () => clearInterval(i); }, [busy]);
  return <Pixels rows={miniRows(state, color, busy ? t : 0)} px={px} label="agent" />;
}
