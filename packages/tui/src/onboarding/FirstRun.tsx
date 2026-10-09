import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ASCII_CENTO, MascotDriver, type CentoColor, type MascotFrame } from '@centcom/mascot';
import type { ColorTier } from '@centcom/theme';
import { createTheme } from '@centcom/theme';
import { PixelView, Rich, ThemeCtx, useTheme } from '../components/ui.js';
import { sp } from '../util/text.js';
import { FIRST_RUN } from './copy.js';

/** Rows the half-block Cento needs; below that the ASCII one is used. */
export const LARGE_MASCOT_ROWS = 30;
export interface FirstRunProps { onDone: () => void; width: number; height: number; tier: ColorTier; mascotAllowed: boolean; reducedMotion?: boolean; color?: CentoColor; /** Plain text only (screen readers). */ plain?: boolean; theme?: 'dark' | 'light' | 'hc' }

/** The one-time welcome: Cento waving, one sentence, one command to try, where to read more. Any key closes it. */
export function FirstRun(p: FirstRunProps) { return <ThemeCtx.Provider value={createTheme(p.theme ?? 'dark', p.tier)}><FirstRunBody {...p} /></ThemeCtx.Provider>; }
function FirstRunBody({ onDone, width, height, tier, mascotAllowed, reducedMotion, color = 'violet', plain }: FirstRunProps) {
  useInput(() => onDone());
  const big = mascotAllowed && !plain && tier !== 'none' && height >= LARGE_MASCOT_ROWS;
  if (plain) return <Box flexDirection="column"><Text>{FIRST_RUN.sentence}</Text><Text>Try: {FIRST_RUN.command} ({FIRST_RUN.hint}).</Text><Text>{FIRST_RUN.more}</Text><Text>{FIRST_RUN.key}</Text></Box>;
  return (
    <Box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center">
      {big ? <Waving color={color} tier={tier} reduced={!!reducedMotion} /> : mascotAllowed ? <AsciiCento /> : null}
      <Box marginTop={1}><Text>{FIRST_RUN.sentence}</Text></Box>
      <Box marginTop={1}><Rich line={[sp('Try  ', { c: 'text.secondary' }), sp(FIRST_RUN.command, { c: 'accent.hover', b: true }), sp(`  ${FIRST_RUN.hint}`, { c: 'text.secondary' })]} /></Box>
      <Box marginTop={1}><Rich line={[sp(FIRST_RUN.more, { c: 'text.muted' })]} /></Box>
      <Box marginTop={1}><Rich line={[sp(FIRST_RUN.key, { c: 'text.muted' })]} /></Box>
    </Box>
  );
}
function AsciiCento() { const theme = useTheme(); void theme; return <Box flexDirection="column" alignItems="center">{['  ¡', '(•_•)/', '/|||\\'].map((l, i) => <Text key={i}>{l}</Text>)}</Box>; }
function Waving({ color, tier, reduced }: { color: CentoColor; tier: ColorTier; reduced: boolean }) {
  const driver = useMemo(() => new MascotDriver({ color, reducedMotion: reduced, dwellMs: 0 }), [color, reduced]);
  const [f, setF] = useState<MascotFrame>(() => { driver.setState('first-run'); return driver.frame; });
  useEffect(() => { driver.start(); const u = driver.subscribe(setF); return () => { u(); driver.stop(); }; }, [driver]);
  return <PixelView rows={f.rows} tier={tier} width={f.width} height={Math.ceil(f.height / 2)} />;
}
void ASCII_CENTO;
