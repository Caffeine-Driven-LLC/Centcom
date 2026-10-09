import React, { useEffect, useMemo, useState } from 'react';
import { Box } from 'ink';
import { MascotDriver, logoRows, renderHalfBlock, type CentoColor, type MascotFrame } from '@centcom/mascot';
import { useTheme, PixelView, Rich } from './ui.js';
import { sp, truncate, type Line } from '../util/text.js';
import { ago } from '../sessions.js';
import type { AppState } from '../state/model.js';

export function Welcome({ s, width, height, color, reduced, calm = 1, mascot = true }: { s: AppState; width: number; height: number; color: CentoColor; reduced: boolean; /** 1 = normal; more = the animation runs that many times slower (nothing has happened for a while). */ calm?: number; /** false when you turned the mascot off: no picture, nothing animating. */ mascot?: boolean }) {
  const theme = useTheme();
  const driver = useMemo(() => new MascotDriver({ color, reducedMotion: reduced, dwellMs: 0 }), [color, reduced]);
  const [f, setF] = useState<MascotFrame>(() => { driver.setState('first-run'); return driver.frame; });
  useEffect(() => { driver.setState('first-run'); driver.start(); const u = driver.subscribe(setF); return () => { u(); driver.stop(); }; }, [driver]);
  useEffect(() => { driver.setSpeed(calm); }, [driver, calm]);
  useEffect(() => { driver.setPaused(!mascot); }, [driver, mascot]);
  const logo = renderHalfBlock(logoRows('CENTCOM', 'B'), theme.tier);
  const me = s.agents.find((a) => a.mine);
  const status: Line = s.demo
    ? [sp('Demo mode', { c: 'status.warning', b: true }), sp('  scripted agent, no model or login needed', { c: 'text.secondary' })]
    : me?.loginKind && me.loginKind !== 'unknown' ? [sp('✓ ', { c: 'status.success' }), sp(`${s.engineLabel} is ready`, { c: 'text.primary' }), sp(`  (${me.loginKind === 'subscription' ? 'your subscription' : me.loginKind === 'api_key' ? 'your API key' : 'your cloud account'})`, { c: 'text.muted' })]
      : [sp('Driving your own ', { c: 'text.secondary' }), sp(s.engineLabel, { c: 'text.primary', b: true }), sp('. We never see your login.', { c: 'text.secondary' })];
  const tips: Line[] = [
    [sp('Type a task and press ', { c: 'text.secondary' }), sp('Enter', { c: 'text.primary', b: true })],
    [sp('/', { c: 'accent.hover', b: true }), sp(' commands   ', { c: 'text.secondary' }), sp('?', { c: 'accent.hover', b: true }), sp(' help   ', { c: 'text.secondary' }), sp('ctrl+k', { c: 'accent.hover', b: true }), sp(' palette', { c: 'text.secondary' })],
    [sp('shift+tab', { c: 'accent.hover', b: true }), sp(' permission mode   ', { c: 'text.secondary' }), sp('esc', { c: 'accent.hover', b: true }), sp(' interrupt', { c: 'text.secondary' })],
    ...(s.demo ? [[sp('try  ', { c: 'text.muted' }), sp('/demo fix', { c: 'signal' }), sp('   /demo search', { c: 'signal' }), sp('   /demo delete', { c: 'signal' })] as Line] : []),
  ];
  const wide = width >= 70;
  const last = s.lastSession && !s.demo ? s.lastSession : undefined; const room = wide ? width - f.width - 6 : width - 2; // the text column beside (or under) the picture
  if (last) { const when = ago(last.when); tips.push([sp('/resume', { c: 'accent.hover', b: true }), sp('  continue "' + truncate(last.title, Math.max(8, room - 19 - when.length - 4)) + '" · ' + when, { c: 'text.secondary' })]); }
  const text = (
    <Box flexDirection="column" marginLeft={wide ? 2 : 0}>
      <Box flexDirection="column">{logo.map((l, i) => <Box key={i}><Rich line={[sp(l)]} /></Box>)}</Box>
      <Box marginTop={1}><Rich line={[sp('Command many hands.', { c: 'text.primary', b: true })]} /></Box>
      <Box marginTop={1}><Rich line={status} /></Box>
      <Box marginTop={1} flexDirection="column">{tips.map((t, i) => <Rich key={i} line={t} />)}</Box>
    </Box>
  );
  return (
    <Box width={width} height={height} alignItems="center" justifyContent="center" flexDirection={wide ? 'row' : 'column'}>
      {mascot ? <PixelView rows={f.rows} tier={theme.tier} width={f.width} height={Math.ceil(f.height / 2)} /> : null}
      {text}
    </Box>
  );
}
