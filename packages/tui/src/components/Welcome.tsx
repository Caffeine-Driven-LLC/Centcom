import React from 'react';
import { Box } from 'ink';
import { getBaked, logoRows, renderHalfBlock, type CentoColor } from '@centcom/mascot';
import { useTheme, useUnicode, Rich } from './ui.js';
import { Cento } from '../pixel/index.js';
import { animationForState } from '../mascot/stateMap.js';
import { sp, truncate, type Line } from '../util/text.js';
import { ago } from '../sessions.js';
import type { AppState } from '../state/model.js';

export function Welcome({ s, width, height, color, reduced, calm = 1, mascot = true }: { s: AppState; width: number; height: number; color: CentoColor; reduced: boolean; /** 1 = normal; more = the animation runs that many times slower (nothing has happened for a while). */ calm?: number; /** false when you turned the mascot off: no picture, nothing animating. */ mascot?: boolean }) {
  const theme = useTheme(); const uni = useUnicode();
  const animation = animationForState('first-run'); const baked = getBaked(animation); const mw = Math.max(baked?.w ?? 14, 14); const mh = Math.ceil((baked?.h ?? 16) / 2);
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
  const last = s.lastSession && !s.demo ? s.lastSession : undefined; const room = wide ? width - mw - 6 : width - 2; // the text column beside (or under) the picture
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
      {mascot ? <Box width={mw} height={mh} flexShrink={0}><Cento animation={animation} color={color} tier={theme.tier} unicode={uni} motion={reduced ? 'reduced' : 'full'} playing={calm < 8} /></Box> : null}
      {text}
    </Box>
  );
}
