import React from 'react';
import { Box } from 'ink';
import type { AppState } from '../state/model.js';
import { Rich } from './ui.js';
import { formatCost, formatTokens, fit, lineWidth, sp, type Line } from '../util/text.js';

const MODE: Record<string, [string, 'accent.hover' | 'status.warning' | 'status.info' | 'status.danger']> = {
  default: ['ask first', 'accent.hover'], acceptEdits: ['accept edits', 'status.warning'], plan: ['plan · read-only', 'status.info'], bypassPermissions: ['⚠ NO APPROVALS', 'status.danger'],
};

export function StatusLine({ s, width }: { s: AppState; width: number }) {
  const me = s.agents.find((a) => a.mine)!;
  const [mode, mc] = MODE[s.settings.permissionMode]!;
  const others = s.agents.filter((a) => !a.mine);
  const need = others.filter((a) => a.state === 'awaiting-approval').length + s.approvals.length;
  const five = s.limits.find((l) => l.name === 'five_hour');
  const fields: { key: string; line: Line }[] = [
    { key: 'mode', line: [sp('» ', { c: mc }), sp(mode, { c: mc })] },
    { key: 'state', line: s.busy ? [sp('● ', { c: 'signal' }), sp(me.state.replace(/-/g, ' '), { c: 'text.secondary' })] : [sp('○ ', { c: 'text.muted' }), sp('idle', { c: 'text.muted' })] },
    ...(need ? [{ key: 'need', line: [sp(`${need} need${need === 1 ? 's' : ''} you`, { c: 'status.warning', b: true })] }] : []),
    ...(s.agents.length > 1 ? [{ key: 'agents', line: [sp(`${s.agents.filter((a) => a.busy).length}/${s.agents.length} agents working`, { c: 'text.muted' })] }] : []),
    ...(me.inTok + me.outTok ? [{ key: 'tok', line: [sp(`${formatTokens(me.inTok + me.outTok)} tok`, { c: 'text.muted' })] }] : []),
    ...(me.cost ? [{ key: 'cost', line: [sp(formatCost(me.cost) + ' est.', { c: 'text.muted' })] }] : []),
    ...(five ? [{ key: 'limit', line: [sp(`5h ${Math.round(five.utilization * 100)}%`, { c: five.utilization >= 0.9 ? 'status.danger' : five.utilization >= 0.75 ? 'status.warning' : 'text.muted' })] }] : []),
  ];
  const hints: Line = [sp('? help', { c: 'text.muted' }), sp('  ctrl+k palette', { c: 'text.muted' })];
  // drop optional fields from the right until it fits (priority: mode, state, need, agents, tok, cost, limit)
  const sepL: Line = [sp('  ·  ', { c: 'border.default' })];
  const build = (n: number): Line => fields.slice(0, n).flatMap((f, i) => (i ? [...sepL, ...f.line] : f.line));
  let n = fields.length;
  while (n > 2 && lineWidth(build(n)) + lineWidth(hints) + 3 > width) n--;
  const left = build(n);
  const gap = Math.max(1, width - lineWidth(left) - lineWidth(hints) - 1);
  return <Box height={1} width={width}><Rich line={fit([sp(' '), ...left, sp(' '.repeat(gap)), ...hints], width)} /></Box>;
}
