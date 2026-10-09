import React from 'react';
import { Box } from 'ink';
import { miniRows, type MascotDriver } from '@centcom/mascot';
import { PixelView, Rich, useMascotFrame, useTheme, useTick, sameUnlessTyping } from './ui.js';
import { SPINNER } from '../util/verbs.js';
import { formatCost, formatElapsed, formatTokens, sp, truncate, truncateMiddle, type Line } from '../util/text.js';
import type { AppState } from '../state/model.js';

export const LARGE_H = 8, LARGE_W = 26;

function infoLines(s: AppState, spin: string, width: number, now: number): Line[] {
  const me = s.agents.find((a) => a.mine)!;
  const running = [...s.items].reverse().find((i) => i.kind === 'tool' && i.status === 'running');
  const lastNotice = [...s.items].reverse().find((i) => i.kind === 'notice');
  if (s.approvals.length) {
    const a = s.approvals[0]!;
    return [[sp('? ', { c: 'status.warning', b: true }), sp('Waiting for you', { c: 'status.warning', b: true })], [sp(truncate(a.req.summary, width), { c: 'text.secondary' })], [sp(a.req.risk === 'high' ? 'y yes · n no' : 'y yes · s session · a always · n no', { c: 'text.muted' })]];
  }
  if (s.busy) {
    const elapsed = s.turnStartedAt ? formatElapsed(now - s.turnStartedAt) : '';
    const tok = me.inTok + me.outTok;
    const act = running && running.kind === 'tool' ? `${running.name} ${running.path ?? running.command ?? running.summary}` : '';
    const verb = s.settings.reducedMotion || s.settings.spinner === 'plain' ? 'Working…' : s.verb;
    return [
      [sp(spin + ' ', { c: 'signal', b: true }), sp(truncate(verb, width - 3), { c: 'text.secondary' })],
      [sp([elapsed, tok ? `↑ ${formatTokens(tok)} tokens` : '', 'esc to interrupt'].filter(Boolean).join('  ·  '), { c: 'text.muted' })],
      ...(act ? [[sp('▸ ', { c: 'text.muted' }), sp(truncateMiddle(act, width - 3), { c: 'text.secondary' })] as Line] : []),
    ];
  }
  if (lastNotice && lastNotice.kind === 'notice' && lastNotice.level === 'error' && s.items[s.items.length - 1] === lastNotice) {
    return [[sp('✗ ', { c: 'status.danger', b: true }), sp(lastNotice.text, { c: 'status.danger', b: true })], ...(lastNotice.detail ? [[sp(truncate(lastNotice.detail.split('\n')[0]!, width), { c: 'text.secondary' })] as Line] : [])];
  }
  const done = s.items.length > 0;
  return [
    [sp('○ ', { c: 'signal' }), sp(done ? 'Ready' : 'Ready when you are', { c: 'text.primary', b: true }), ...(done && me.cost ? [sp(`   ${formatTokens(me.inTok + me.outTok)} tokens · ${formatCost(me.cost)}`, { c: 'text.muted' })] : [])],
    [sp('Type a task · / for commands · ? for help', { c: 'text.muted' })],
  ];
}

export const LiveStrip = React.memo(LiveStripImpl, sameUnlessTyping as never) as typeof LiveStripImpl;
function LiveStripImpl({ s, driver, width, size, calm = 1 }: { s: AppState; driver: MascotDriver; width: number; size: 'large' | 'small' | 'off'; /** 1 = normal; more = the animation runs that many times slower (nothing has happened for a while). */ calm?: number }) {
  const theme = useTheme();
  const f = useMascotFrame(driver);
  const spinning = s.busy && !s.settings.reducedMotion;
  const tick = useTick(120, spinning);
  const slow = useTick(500 * calm, size === 'small' && !s.settings.reducedMotion);
  const spin = spinning ? SPINNER[tick % SPINNER.length]! : '…';
  const me = s.agents.find((a) => a.mine)!;
  const now = Date.now();
  if (size === 'off') {
    const l = infoLines(s, spin, width - 2, now)[0]!;
    return <Box height={1}><Rich line={l} /></Box>;
  }
  const small = size === 'small';
  const boxW = small ? 10 : LARGE_W; const boxH = small ? 4 : LARGE_H;
  const info = infoLines(s, spin, Math.max(10, width - boxW - 2), now);
  return (
    <Box height={boxH} width={width}>
      {small ? <PixelView rows={miniRows(me.mini, s.settings.color, slow)} tier={theme.tier} width={boxW} height={boxH} /> : <PixelView rows={f.rows} tier={theme.tier} width={boxW} height={boxH} />}
      <Box flexDirection="column" justifyContent="flex-end" height={boxH} paddingBottom={small ? 0 : 1}>{info.map((l, i) => <Rich key={i} line={l} />)}</Box>
    </Box>
  );
}
