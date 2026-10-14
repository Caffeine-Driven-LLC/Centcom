import React, { useRef } from 'react';
import { Box } from 'ink';
import { Rich, useTheme, useTick, sameUnlessTyping } from './ui.js';
import { Cento } from '../pixel/index.js';
import { useMascotView, type MascotDriver } from '../mascot/index.js';
import { createVerbPicker, isSeriousState, nextVerbDelayMs, plainVerb, spinnerLine, FRAME_MS, type VerbPicker } from '../spinner/index.js';
import { formatCost, formatElapsed, formatTokens, sp, truncate, truncateMiddle, type Line } from '../util/text.js';
import type { AppState } from '../state/model.js';

export const LARGE_H = 10, LARGE_W = 30, SMALL_H = 2, SMALL_W = 8;

/** What the working line says: the glyph, the verb and the parenthesis (lane C040). */
export interface WorkLine { glyph: string; verb: string; meta: string }
function infoLines(s: AppState, work: WorkLine, width: number, now: number): Line[] {
  const me = s.agents.find((a) => a.mine)!;
  const running = [...s.items].reverse().find((i) => i.kind === 'tool' && i.status === 'running');
  const lastNotice = [...s.items].reverse().find((i) => i.kind === 'notice');
  if (s.approvals.length) {
    const a = s.approvals[0]!;
    return [[sp('? ', { c: 'status.warning', b: true }), sp('Waiting for you', { c: 'status.warning', b: true }), ...(s.approvals.length > 1 ? [sp(`  +${s.approvals.length - 1} more`, { c: 'text.muted' })] : [])], [sp(truncate(a.req.summary, width), { c: 'text.secondary' })]]; // the keys are in the dialog below
  }
  if (s.busy) {
    const act = running && running.kind === 'tool' ? `${running.name} ${running.path ?? running.command ?? running.summary}` : '';
    return [
      [sp(work.glyph + ' ', { c: 'signal', b: true }), sp(work.verb, { c: 'text.secondary' }), ...(work.meta ? [sp('   ' + work.meta, { c: 'text.muted' })] : [])],
      ...(act ? [[sp('▸ ', { c: 'text.muted' }), sp(truncateMiddle(act, width - 3), { c: 'text.secondary' })] as Line] : []),
    ];
  }
  if (lastNotice && lastNotice.kind === 'notice' && lastNotice.level === 'error' && s.items[s.items.length - 1] === lastNotice) {
    return [[sp('✗ ', { c: 'status.danger', b: true }), sp(truncate(lastNotice.text, width - 3), { c: 'status.danger', b: true })], [sp('details above · type to try again', { c: 'text.muted' })]];
  }
  const done = s.items.length > 0;
  return [
    [sp('○ ', { c: 'signal' }), sp(done ? 'Ready' : 'Ready when you are', { c: 'text.primary', b: true }), ...(done && me.cost ? [sp(`   ${formatTokens(me.inTok + me.outTok)} tokens · ${formatCost(me.cost)}`, { c: 'text.muted' })] : [])],
    [sp('Type a task · / for commands · ? for help', { c: 'text.muted' })],
  ];
}

export const LiveStrip = React.memo(LiveStripImpl, sameUnlessTyping as never) as typeof LiveStripImpl;
function LiveStripImpl({ s, mascot, width, size, calm = 1 }: { s: AppState; /** What Cento does for the state (lane C046); the strip draws it with the `Cento` component. */ mascot: MascotDriver; width: number; size: 'large' | 'small' | 'off'; /** 1 = normal; more = the animation runs that many times slower (nothing has happened for a while). */ calm?: number }) {
  const theme = useTheme();
  const view = useMascotView(mascot, 'main');
  const spinning = s.busy && !s.settings.reducedMotion;
  const tick = useTick(FRAME_MS, spinning); void tick;
  const me0 = s.agents.find((a) => a.mine)!; const plain = s.settings.reducedMotion || s.settings.spinner === 'plain';
  const picker = useRef<VerbPicker | undefined>(undefined); picker.current ??= createVerbPicker({ rng: Math.random }); const verbAt = useRef<{ verb: string; until: number; key: string } | undefined>(undefined);
  const t0 = Date.now(); const elapsedMs = s.turnStartedAt ? Math.max(0, t0 - s.turnStartedAt) : 0; const serious = isSeriousState(me0.state); const kind = `${me0.state}:${plain}:${width < 60}`;
  if (s.busy && (!verbAt.current || verbAt.current.key !== kind || t0 >= verbAt.current.until)) { // a new line every 3 to 6 seconds, at once when the state changes; plain words where a joke would be wrong
    const verb = plain ? 'Working…' : serious ? plainVerb(me0.state) : picker.current.next({ state: me0.state, elapsedMs, width, serious }); verbAt.current = { verb, until: t0 + nextVerbDelayMs(Math.random), key: kind };
  }
  const work = spinnerLine({ elapsedMs, verb: verbAt.current?.verb ?? 'Working…', tokens: me0.inTok + me0.outTok || undefined, interruptible: true, width: Math.max(10, width - (size === 'large' ? LARGE_W : size === 'small' ? SMALL_W : 0) - 2), motion: s.settings.reducedMotion ? 'reduced' : 'full', still: !spinning });
  const me = s.agents.find((a) => a.mine)!;
  const now = Date.now();
  if (size === 'off') {
    const l = infoLines(s, work, width - 2, now)[0]!;
    return <Box height={1}><Rich line={l} /></Box>;
  }
  const small = size === 'small';
  const boxW = small ? SMALL_W : LARGE_W; const boxH = small ? SMALL_H : LARGE_H;
  const info = infoLines(s, work, Math.max(10, width - boxW - 2), now);
  return (
    <Box height={boxH} width={width}>
      <Box width={boxW} height={boxH} flexShrink={0} flexDirection="column" justifyContent="flex-end" overflow="hidden"><Cento animation={view.animation} loop={view.loop} color={s.settings.color} size={small ? 'mini' : 'hero'} tier={theme.tier} unicode={theme.tier !== 'none'} motion={s.settings.reducedMotion ? 'reduced' : 'full'} playing={calm < 8} /></Box>
      <Box flexDirection="column" justifyContent="flex-end" height={boxH} paddingBottom={small ? 0 : 1}>{info.map((l, i) => <Rich key={i} line={l} />)}</Box>
    </Box>
  );
}
