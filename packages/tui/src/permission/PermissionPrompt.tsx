import React, { useEffect, useMemo, useState } from 'react';
import { Box, useInput } from 'ink';
import { Rich } from '../components/ui.js';
import { sp, truncate, type Line } from '../util/text.js';
import { createPromptMachine, type MachineState } from './machine.js';
import { countdown, visibleText, type ApprovalDecisionInput, type ApprovalView } from './model.js';

export const MAX_COMMAND_ROWS = 6; export const boxWidth = (cols: number) => Math.min(cols - 2, 78);
/** The box's rows as data, so the layout is testable. */
export function promptRows(v: ApprovalView, o: { width: number; canDecide: boolean; onEdit: boolean; remainingMs: number; message?: string; phase: MachineState['phase']; hostName?: string }): Line[] {
  const inner = o.width - 4; const rows: Line[] = []; const risk = v.risk === 'high' ? 'status.danger' : 'status.warning';
  rows.push([sp(truncate(v.title, inner), { c: 'text.primary', b: true })]);
  const cmd = visibleText(v.command ?? v.path ?? '').split('\n'); for (const l of cmd.slice(0, MAX_COMMAND_ROWS)) rows.push([sp('  ' + truncate(l, inner - 2), { c: 'text.primary' })]); if (cmd.length > MAX_COMMAND_ROWS) rows.push([sp(`  ⋯ +${cmd.length - MAX_COMMAND_ROWS} lines (v to view all)`, { c: 'text.muted' })]);
  if (v.directory) rows.push([sp(truncate(`in ${visibleText(v.directory)}${v.branch ? ` (${visibleText(v.branch)})` : ''}`, inner), { c: 'text.secondary' })]);
  rows.push([sp(truncate(`${v.engine} · ${v.provider} · ${v.accountLine}`, inner), { c: 'text.muted' }), sp(`   ${v.risk} risk`, { c: risk, b: true })]);
  rows.push([sp(`${v.agentLabel} · ${v.ownerName}`, { c: 'text.muted' }), sp(o.phase === 'expired' ? '   Expired' : `   expires in ${countdown(o.remainingMs)}`, { c: 'text.muted' })]); rows.push([]);
  if (!o.canDecide) rows.push([sp(`Waiting for ${o.hostName ?? v.ownerName} to decide.`, { c: 'text.muted' })]);
  else if (o.phase === 'confirming') rows.push([sp(o.message ?? 'Type y then Enter to confirm.', { c: 'status.danger', b: true })]);
  else if (o.phase !== 'expired') { const k: Line = []; const add = (key: string, label: string) => { if (k.length) k.push(sp('  ', {})); k.push(sp(`[${key}]`, { c: 'accent.hover', b: true }), sp(' ' + label, { c: 'text.secondary' })); }; if (v.allowedScopes.includes('once')) add('y', 'yes'); if (v.allowedScopes.includes('session')) add('s', 'this session'); if (v.allowedScopes.includes('always')) add('a', 'always'); add('n', 'no'); if (v.editable && o.onEdit) add('e', 'edit'); rows.push(k); }
  return rows;
}
/** One permission question. Destructive ones have a heavy red border (`┏━┓`, so it shows without colour) and need y then Enter. */
export function PermissionPrompt({ request, canDecide, onDecide, onEdit, now = () => new Date(), cols = 80, hostName }: { request: ApprovalView; canDecide: boolean; onDecide: (d: ApprovalDecisionInput) => void; onEdit?: (cmd: string) => void; now?: () => Date; cols?: number; hostName?: string }) {
  const m = useMemo(() => createPromptMachine({ view: request, canDecide, now: () => now().getTime(), onDecide, onEdit }), [request.approvalId]); const [st, setSt] = useState<MachineState>(m.state());
  useEffect(() => { const h = setInterval(() => setSt(m.tick()), 1000); return () => clearInterval(h); }, [m]);
  useInput((input, key) => { m.key(key.return ? 'return' : key.escape ? 'escape' : input); setSt(m.state()); }, { isActive: canDecide });
  const w = boxWidth(cols); const rows = promptRows(request, { width: w, canDecide, onEdit: !!onEdit, remainingMs: st.remainingMs, message: st.message, phase: st.phase, hostName }); const danger = request.risk === 'high' || request.destructive;
  return <Box width={w} flexDirection="column" borderStyle={danger ? 'bold' : 'round'} borderColor={danger ? 'status.danger' : 'status.warning'} paddingX={1}>{rows.map((r, i) => <Rich key={i} line={r} />)}</Box>;
}
