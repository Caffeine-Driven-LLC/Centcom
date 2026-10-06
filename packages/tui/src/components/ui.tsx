import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { Box, Text } from 'ink';
import { createTheme, inkColor, type ColorTier, type Theme } from '@centcom/theme';
import { PAL_HEX, renderHalfBlock, renderPlain, type MascotDriver, type MascotFrame } from '@centcom/mascot';
import type { Colour, Line } from '../util/text.js';

export const ThemeCtx = createContext<Theme>(createTheme('dark', 'truecolor'));
export const useTheme = () => useContext(ThemeCtx);

/** Resolve a semantic token or a literal hex to a colour for Ink (undefined = terminal default when colour is off). */
export function useCol() {
  const t = useTheme();
  return (c: Colour | undefined): string | undefined => (c === undefined ? undefined : inkColor(c.startsWith('#') ? c : t.c(c as never), t.tier));
}

export function Rich({ line }: { line: Line }) {
  const col = useCol();
  if (line.length === 0) return <Text> </Text>;
  return (
    <Text wrap="truncate">
      {line.map((s, i) => (
        <Text key={i} color={col(s.c)} backgroundColor={col(s.bg)} bold={s.b} dimColor={s.d} italic={s.i} underline={s.u} inverse={s.r}>{s.t}</Text>
      ))}
    </Text>
  );
}

export function RichLines({ lines }: { lines: Line[] }) { return <Box flexDirection="column">{lines.map((l, i) => <Rich key={i} line={l} />)}</Box>; }

/** Subscribe to the mascot driver's frames. */
export function useMascotFrame(driver: MascotDriver): MascotFrame {
  const [f, setF] = useState<MascotFrame>(() => driver.frame);
  useEffect(() => driver.subscribe(setF), [driver]);
  return f;
}

/** Cento (or any pixel rows) as terminal text; falls back to plain blocks when colour is off. */
export function PixelView({ rows, tier, width, height, align = 'left' }: { rows: readonly string[]; tier: ColorTier; width?: number; height?: number; align?: 'left' | 'center' }) {
  const lines = tier === 'none' ? renderPlain(rows) : renderHalfBlock(rows, tier);
  const h = height ?? lines.length;
  const shown = lines.slice(Math.max(0, lines.length - h)); // anchor to the bottom: clip the top if too tall
  const pad = Array.from({ length: Math.max(0, h - shown.length) }, () => '');
  return (
    <Box flexDirection="column" width={width} height={h} flexShrink={0} alignItems={align === 'center' ? 'center' : 'flex-start'}>
      {[...pad, ...shown].map((l, i) => <Text key={i} wrap="truncate">{l || ' '}</Text>)}
    </Box>
  );
}

/** A repeating tick for spinners and mini sprites; stops when `active` is false. */
export function useTick(ms: number, active = true): number {
  const [n, setN] = useState(0);
  useEffect(() => { if (!active) return; const t = setInterval(() => setN((x) => x + 1), ms); return () => clearInterval(t); }, [ms, active]);
  return n;
}

export function useStore<S>(store: { get: () => S; subscribe: (l: () => void) => () => void }): S { return useSyncExternalStore(store.subscribe, store.get); }

export const PAL = PAL_HEX;
