import React from 'react';
import { Box } from 'ink';
import type { AppState } from '../state/model.js';
import { Rich, sameUnlessTyping } from './ui.js';
import { counts as nightCounts } from '../night/model.js';
import { formatCost, formatReset, formatTokens, fit, lineWidth, sp, type Line } from '../util/text.js';

const lvl = (p: number): 'text.muted' | 'status.warning' | 'status.danger' => (p >= 90 ? 'status.danger' : p >= 70 ? 'status.warning' : 'text.muted');
const bar = (p: number) => { const n = Math.round(Math.max(0, Math.min(100, p)) / 20); return '█'.repeat(n) + '░'.repeat(5 - n); };
const WIN: Record<string, string> = { five_hour: 'session', seven_day: 'week' };

const MODE: Record<string, [string, 'accent.hover' | 'status.warning' | 'status.info' | 'status.danger']> = {
  default: ['ask first', 'accent.hover'], acceptEdits: ['accept edits', 'status.warning'], plan: ['plan · read-only', 'status.info'], bypassPermissions: ['⚠ NO APPROVALS', 'status.danger'],
};

export const StatusLine = React.memo(StatusLineImpl, sameUnlessTyping as never) as typeof StatusLineImpl;
function StatusLineImpl({ s, width }: { s: AppState; width: number }) {
  const me = s.agents.find((a) => a.mine)!;
  const [mode, mc] = MODE[s.settings.permissionMode]!;
  const others = s.agents.filter((a) => !a.mine);
  const need = others.filter((a) => a.state === 'awaiting-approval').length + s.approvals.length;
  const gauge = (key: string, name: string, pct: number, extra = ''): { key: string; line: Line } => ({ key, line: [sp(name + ' ', { c: 'text.muted' }), sp(bar(pct), { c: lvl(pct) === 'text.muted' ? 'accent.hover' : lvl(pct) }), sp(` ${Math.round(pct)}%`, { c: lvl(pct) === 'text.muted' ? 'text.primary' : lvl(pct) }), ...(extra ? [sp(' ' + extra, { c: 'text.muted' })] : [])] });
  const fields: { key: string; line: Line }[] = [
    { key: 'mode', line: [sp('» ', { c: mc }), sp(mode, { c: mc })] },
    ...(s.night.running || s.night.armed || s.night.tasks.length ? [{ key: 'night', line: (() => { const c = nightCounts(s.night); const t = s.night.running ? `night ${c.done + c.failed}/${c.total}` : c.queued ? `night · ${c.queued} queued` : 'night ready'; return [sp('◐ ', { c: s.night.running ? 'signal' : 'accent.hover', b: true }), sp(t, { c: s.night.running ? 'signal' : 'accent.hover', b: s.night.running })] as Line; })() }] : []),
    { key: 'state', line: s.busy ? [sp('● ', { c: 'signal' }), sp(me.state.replace(/-/g, ' '), { c: 'text.secondary' })] : [sp('○ ', { c: 'text.muted' }), sp('idle', { c: 'text.muted' })] },
    ...(need ? [{ key: 'need', line: [sp(`${need} need${need === 1 ? 's' : ''} you`, { c: 'status.warning', b: true })] }] : []),
    ...(me.ctxPct !== undefined ? [gauge('ctx', 'context', me.ctxPct, me.ctxTokens && me.ctxWindow ? `${formatTokens(me.ctxTokens)}/${formatTokens(me.ctxWindow)}` : '')] : []),
    ...s.limits.map((l) => gauge('lim' + l.name, WIN[l.name] ?? l.name.replace(/_/g, ' '), l.utilization * 100, l.resets_at ? `↻ ${formatReset(l.resets_at)}` : '')),
    ...(me.inTok + me.outTok ? [{ key: 'tok', line: [sp(`↑${formatTokens(me.inTok)} ↓${formatTokens(me.outTok)}`, { c: 'text.muted' })] }] : []),
    ...(me.cost ? [{ key: 'cost', line: [sp(formatCost(me.cost) + ' est.', { c: 'text.muted' })] }] : []),
    ...(s.agents.length > 1 ? [{ key: 'agents', line: [sp(`${s.agents.filter((a) => a.busy).length}/${s.agents.length} agents`, { c: 'text.muted' })] }] : []),
  ];
  const hints: Line = [sp('? help', { c: 'text.muted' }), sp('  ctrl+k palette', { c: 'text.muted' })];
  // drop optional fields from the right until it fits (priority: mode, state, need, context, limits, tokens, cost, agents)
  const sepL: Line = [sp('  ·  ', { c: 'border.default' })];
  const build = (n: number): Line => fields.slice(0, n).flatMap((f, i) => (i ? [...sepL, ...f.line] : f.line));
  let n = fields.length;
  while (n > 2 && lineWidth(build(n)) + lineWidth(hints) + 3 > width) n--;
  const left = build(n);
  const gap = Math.max(1, width - lineWidth(left) - lineWidth(hints) - 2);
  return <Box height={1} width={width}><Rich line={fit([sp(' '), ...left, sp(' '.repeat(gap)), ...hints, sp(' ')], width)} /></Box>;
}
