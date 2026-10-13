import React from 'react';
import { Box } from 'ink';
import { miniRows } from '@centcom/mascot';
import { PixelView, Rich, useTheme, useTick, useCol, sameUnlessTyping } from './ui.js';
import { formatCost, sp, truncate, type Line } from '../util/text.js';
import type { AppState, AgentView } from '../state/model.js';
import { priorityTier, stateLabel, type Tone } from '../fleet/labels.js';

/** The words and their order come from the fleet module's table (lane C042), the same one the rail and the web board use. */
const TONE: Record<Tone, 'signal' | 'status.warning' | 'status.danger' | 'status.success' | 'text.muted'> = { work: 'signal', human: 'status.warning', good: 'status.success', bad: 'status.danger', muted: 'text.muted' };

export const FLEET_W = 30;

/** Most urgent first (errors, then what needs you, then work, then idle); a stable sort keeps the join order inside a tier. */
export function order(a: AgentView, b: AgentView) { return priorityTier(a.state) - priorityTier(b.state); }

export const FleetPanel = React.memo(FleetPanelImpl, sameUnlessTyping as never) as typeof FleetPanelImpl;
function FleetPanelImpl({ s, width, height }: { s: AppState; width: number; height: number }) {
  const theme = useTheme();
  const col = useCol();
  const tick = useTick(500, !s.settings.reducedMotion && s.agents.some((a) => a.busy));
  const agents = [...s.agents].sort(order);
  const per = 5;
  const fit = Math.max(1, Math.floor((height - 6) / per));
  return (
    <Box flexDirection="column" width={width} height={height} borderStyle="round" borderColor={col('border.default')} paddingX={1}>
      <Rich line={[sp('FLEET', { c: 'text.muted', b: true }), sp(`  ${s.agents.length} agent${s.agents.length === 1 ? '' : 's'}`, { c: 'text.muted' })]} />
      <Box height={1} />
      {agents.slice(0, fit).map((a) => {
        const l = stateLabel(a.state); const word = `${l.glyph} ${l.word}`; const wc = TONE[l.tone];
        const active = a.id === s.activeAgent;
        const lines: Line[] = [
          [sp(a.name, { b: true, c: 'text.primary' }), sp(active ? ' ◂' : '', { c: 'signal' })],
          [sp(word, { c: wc, b: l.tone === 'human' })],
          [sp(truncate(a.branch || a.engine, width - 16), { c: 'text.muted' })],
          [sp(a.cost ? formatCost(a.cost) : '', { c: 'text.muted' })],
        ];
        return (
          <Box key={a.id} height={per - 1} marginBottom={1}>
            <PixelView rows={miniRows(a.mini, a.color, a.busy ? tick : 0)} tier={theme.tier} width={9} height={4} />
            <Box flexDirection="column">{lines.map((l, i) => <Rich key={i} line={l} />)}</Box>
          </Box>
        );
      })}
      {agents.length > fit ? <Rich line={[sp(`+${agents.length - fit} more`, { c: 'text.muted' })]} /> : null}
      <Box flexGrow={1} />
      {s.limits.map((l) => (
        <Rich key={l.name} line={[sp(l.name === 'five_hour' ? '5h ' : '7d ', { c: 'text.muted' }), sp('█'.repeat(Math.round(l.utilization * 10)), { c: l.utilization >= 0.9 ? 'status.danger' : l.utilization >= 0.75 ? 'status.warning' : 'signal' }), sp('░'.repeat(10 - Math.round(l.utilization * 10)), { c: 'border.default' }), sp(` ${Math.round(l.utilization * 100)}%`, { c: 'text.muted' })]} />
      ))}
    </Box>
  );
}
