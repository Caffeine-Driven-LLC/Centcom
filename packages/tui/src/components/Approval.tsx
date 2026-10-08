import React from 'react';
import { Box } from 'ink';
import { Clickable } from '../click.js';
import { useCol, useTick, Rich } from './ui.js';
import { renderDiff } from '../util/diff.js';
import { sp, truncate, truncateMiddle, wrapLine, type Line } from '../util/text.js';
import type { PendingApproval } from '../state/model.js';

export function approvalTitle(a: PendingApproval): string {
  const t = a.req.tool;
  if (t === 'Bash') return 'Allow Cento to run a command?';
  if (['Edit', 'MultiEdit', 'NotebookEdit'].includes(t)) return 'Allow Cento to edit a file?';
  if (t === 'Write') return 'Allow Cento to create a file?';
  return `Allow Cento to use ${t}?`;
}

/** Height of the dialog for layout, given the same inputs as the render. */
export function approvalHeight(a: PendingApproval, width: number, maxDiff = 8): number { return approvalBody(a, width, false, maxDiff).length + 3; }

/** `9:58`: what is left of the time before the engine declines by itself. */
export const countdown = (ms: number): string => { const t = Math.max(0, Math.ceil(ms / 1000)); return t >= 3600 ? `${Math.floor(t / 3600)}h ${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}m` : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
function approvalBody(a: PendingApproval, width: number, confirming: boolean, maxDiff = 8, now = Date.now()): Line[] {
  const r = a.req; const inner = width - 4; const out: Line[] = [];
  const risk = r.risk === 'high' ? ['⚠ high risk', 'status.danger'] as const : r.risk === 'medium' ? ['medium risk', 'status.warning'] as const : ['low risk', 'text.muted'] as const;
  out.push([sp(r.tool, { b: true, c: 'text.primary' }), sp('  ' + truncateMiddle(r.path ?? r.command ?? r.summary, Math.max(10, inner - r.tool.length - 16)), { c: r.path ? 'text.link' : 'signal' }), sp('   ' + risk[0], { c: risk[1], b: r.risk === 'high' })]);
  if (r.command && r.path === undefined && r.command.length > inner - 4) for (const l of wrapLine([sp(r.command, { c: 'signal' })], inner).slice(0, 3)) out.push(l);
  if (r.diff) for (const l of renderDiff(r.diff, inner, maxDiff)) out.push(l);
  out.push([sp(a.agentName === 'you' ? 'runs on your account' : `runs on ${a.agentName}'s account`, { c: 'text.muted', d: true })]);
  if (a.expiresAt !== undefined) out.push([sp(a.expiresAt - now <= 0 ? 'Expired: declined' : `Declines on its own in ${countdown(a.expiresAt - now)}`, { c: a.expiresAt - now < 30_000 ? 'status.warning' : 'text.muted', d: a.expiresAt - now >= 30_000 })]);
  if (r.risk === 'high') out.push([sp(confirming ? 'Press Enter to confirm, or n to cancel.' : 'This looks destructive. Press y, then Enter to confirm.', { c: 'status.danger', b: true })]);
  out.push([sp('[y]', { c: 'status.success', b: true }), sp(' yes   ', { c: 'text.secondary' }), ...(r.risk === 'high' ? [] : [sp('[a]', { c: 'accent.hover', b: true }), sp(' always (this project)   ', { c: 'text.secondary' })]), sp('[n]', { c: 'status.danger', b: true }), sp(' no   ', { c: 'text.secondary' }), sp('esc', { c: 'text.muted' }), sp(' = no', { c: 'text.muted' })]);
  return out;
}

export type ApprovalChoice = 'yes' | 'always' | 'session' | 'no';
export function Approval({ a, width, confirming, maxDiff = 8, onChoose }: { a: PendingApproval; width: number; confirming: boolean; maxDiff?: number; onChoose?: (c: ApprovalChoice) => void }) {
  const col = useCol(); useTick(1000, a.expiresAt !== undefined); // the countdown
  const body = approvalBody(a, width, confirming, maxDiff); const wide = width >= 78; const gap = wide ? 3 : 2;
  const border = a.req.risk === 'high' ? 'status.danger' : 'status.warning';
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={col(border)} width={width} paddingX={1}>
      <Rich line={[sp(truncate(approvalTitle(a), width - 6), { b: true, c: border })]} />
      {body.slice(0, -1).map((l, i) => <Rich key={i} line={l} />)}
      <Box>
        {/* the answers keep their words whole: on a narrow screen the labels get shorter, they are never cut in the middle */}
        <Clickable onClick={() => onChoose?.('yes')}><Rich line={[sp('[y]', { c: 'status.success', b: true }), sp(' yes', { c: 'text.secondary' })]} /></Clickable>
        {a.req.risk === 'high' ? null : <Clickable marginLeft={gap} onClick={() => onChoose?.('session')}><Rich line={[sp('[s]', { c: 'accent.hover', b: true }), sp(' session', { c: 'text.secondary' })]} /></Clickable>}
        {a.req.risk === 'high' ? null : <Clickable marginLeft={gap} onClick={() => onChoose?.('always')}><Rich line={[sp('[a]', { c: 'accent.hover', b: true }), sp(wide ? ' always (this project)' : ' always', { c: 'text.secondary' })]} /></Clickable>}
        <Clickable marginLeft={gap} onClick={() => onChoose?.('no')}><Rich line={[sp('[n]', { c: 'status.danger', b: true }), sp(' no', { c: 'text.secondary' }), ...(wide ? [sp('   esc = no', { c: 'text.muted' })] : [])]} /></Clickable>
      </Box>
    </Box>
  );
}
