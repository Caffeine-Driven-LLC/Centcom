import React, { useEffect, useMemo, useState } from 'react';
import { Box, useInput } from 'ink';
import { Rich } from '../components/ui.js';
import { Clickable } from '../click.js';
import { parseUnifiedDiff } from '../diff/parse.js';
import { renderDiffRows } from '../diff/rows.js';
import { sp, truncate, type Line } from '../util/text.js';
import { createPromptMachine, type MachineState } from './machine.js';
import { countdown, visibleText, type ApprovalDecisionInput, type ApprovalView } from './model.js';

export const MAX_COMMAND_ROWS = 6; export const boxWidth = (cols: number) => Math.min(cols - 2, 78);
/** The box's rows as data, so the layout is testable. */
export function promptRows(v: ApprovalView, o: { width: number; canDecide: boolean; onEdit: boolean; remainingMs: number; message?: string; phase: MachineState['phase']; hostName?: string; /** The change itself, already drawn (see `diffLines`), shown under the command. */ diff?: Line[] }): Line[] {
  const inner = o.width - 4; const rows: Line[] = []; const risk = v.risk === 'high' ? 'status.danger' : 'status.warning';
  rows.push([sp(truncate(v.title, inner), { c: 'text.primary', b: true })]);
  const cmd = visibleText(v.command ?? v.path ?? '').split('\n'); for (const l of cmd.slice(0, MAX_COMMAND_ROWS)) rows.push([sp('  ' + truncate(l, inner - 2), { c: 'text.primary' })]); if (cmd.length > MAX_COMMAND_ROWS) rows.push([sp(`  ⋯ +${cmd.length - MAX_COMMAND_ROWS} lines (v to view all)`, { c: 'text.muted' })]);
  if (o.diff?.length) rows.push(...o.diff);
  if (v.directory) rows.push([sp(truncate(`in ${visibleText(v.directory)}${v.branch ? ` (${visibleText(v.branch)})` : ''}`, inner), { c: 'text.secondary' })]);
  rows.push([sp(truncate(`${v.engine} · ${v.provider} · ${v.accountLine}`, inner), { c: 'text.muted' }), sp(`   ${v.risk} risk`, { c: risk, b: true })]);
  rows.push([sp(`${v.agentLabel} · ${v.ownerName}`, { c: 'text.muted' }), ...(o.phase === 'expired' ? [sp('   Expired', { c: 'text.muted' })] : Number.isFinite(o.remainingMs) ? [sp(`   expires in ${countdown(o.remainingMs)}`, { c: 'text.muted' })] : [])]); rows.push([]);
  if (!o.canDecide) rows.push([sp(`Waiting for ${o.hostName ?? v.ownerName} to decide.`, { c: 'text.muted' })]);
  else if (o.phase === 'confirming') rows.push([sp(o.message ?? 'Type y then Enter to confirm.', { c: 'status.danger', b: true })]);
  else if (o.phase !== 'expired') { const k: Line = []; const add = (key: string, label: string) => { if (k.length) k.push(sp('  ', {})); k.push(sp(`[${key}]`, { c: 'accent.hover', b: true }), sp(' ' + label, { c: 'text.secondary' })); }; if (v.allowedScopes.includes('once')) add('y', 'yes'); if (v.allowedScopes.includes('session')) add('s', 'this session'); if (v.allowedScopes.includes('always')) add('a', 'always'); add('n', 'no'); if (v.editable && o.onEdit) add('e', 'edit'); rows.push(k); }
  return rows;
}
/** The change of an edit as numbered lines with word highlights, cut to `maxRows` with a count of what is left. */
export function diffLines(diff: string | undefined, width: number, maxRows = 8): Line[] {
  if (!diff) return []; let rows; try { rows = renderDiffRows(parseUnifiedDiff(diff), { width: width - 4, expanded: new Set() }); } catch { return []; }
  const shown = rows.slice(0, maxRows).map((r) => r.line); return rows.length > maxRows ? [...shown, [sp(`⋯ ${rows.length - maxRows} more rows`, { c: 'text.muted' })]] : shown;
}
export interface PromptButton { key: string; label: string; send: string }
/** The answers as buttons: what a click sends is the key it names. A destructive one asks again, with Enter. */
export function promptButtons(v: ApprovalView, o: { canDecide: boolean; onEdit: boolean; phase: MachineState['phase'] }): PromptButton[] {
  if (!o.canDecide || o.phase === 'expired' || o.phase === 'done') return [];
  if (o.phase === 'confirming') return [{ key: 'Enter', label: 'confirm', send: 'return' }, { key: 'n', label: 'cancel', send: 'n' }];
  const b: PromptButton[] = []; if (v.allowedScopes.includes('once')) b.push({ key: 'y', label: 'yes', send: 'y' }); if (v.allowedScopes.includes('session')) b.push({ key: 's', label: 'this session', send: 's' }); if (v.allowedScopes.includes('always')) b.push({ key: 'a', label: 'always', send: 'a' });
  b.push({ key: 'n', label: 'no', send: 'n' }); if (v.editable && o.onEdit) b.push({ key: 'e', label: 'edit', send: 'e' }); return b;
}
/** Rows the box takes on screen (border included), for the layout above it. */
export function permissionHeight(v: ApprovalView, o: { cols: number; canDecide: boolean; onEdit?: boolean; maxDiff?: number }): number {
  const w = boxWidth(o.cols); const rows = promptRows(v, { width: w, canDecide: o.canDecide, onEdit: !!o.onEdit, remainingMs: 0, phase: 'active', diff: diffLines(v.diff, w, o.maxDiff) });
  return rows.length + 2; // the last row is the key row; the buttons and the confirm message take its place, so the height never changes
}
/** One permission question. Destructive ones have a heavy red border (`┏━┓`, so it shows without colour) and need y then Enter. */
export function PermissionPrompt({ request, canDecide, onDecide, onEdit, now = () => new Date(), cols = 80, hostName, maxDiff = 8 }: { request: ApprovalView; canDecide: boolean; onDecide: (d: ApprovalDecisionInput) => void; onEdit?: (cmd: string) => void; now?: () => Date; cols?: number; hostName?: string; maxDiff?: number }) {
  const m = useMemo(() => createPromptMachine({ view: request, canDecide, now: () => now().getTime(), onDecide, onEdit }), [request.approvalId]); const [st, setSt] = useState<MachineState>(m.state());
  useEffect(() => { const h = setInterval(() => setSt(m.tick()), 1000); h.unref?.(); return () => clearInterval(h); }, [m]);
  useInput((input, key) => { m.key(key.return ? 'return' : key.escape ? 'escape' : input); setSt(m.state()); }, { isActive: canDecide });
  const w = boxWidth(cols); const diff = useMemo(() => diffLines(request.diff, w, maxDiff), [request.diff, w, maxDiff]);
  const rows = promptRows(request, { width: w, canDecide, onEdit: !!onEdit, remainingMs: st.remainingMs, message: st.message, phase: st.phase, hostName, diff }); const danger = request.risk === 'high' || request.destructive;
  const buttons = promptButtons(request, { canDecide, onEdit: !!onEdit, phase: st.phase }); const keyRow = canDecide && st.phase !== 'expired' && st.phase !== 'done';
  const press = (k: string) => () => { m.key(k); setSt(m.state()); };
  return (
    <Box width={w} flexDirection="column" borderStyle={danger ? 'bold' : 'round'} borderColor={danger ? 'status.danger' : 'status.warning'} paddingX={1}>
      {(keyRow ? rows.slice(0, -1) : rows).map((r, i) => <Rich key={i} line={r} />)}
      {keyRow ? (
        <Box>
          {st.phase === 'confirming' ? <Rich line={[sp((st.message ?? 'Type y then Enter to confirm.') + '  ', { c: 'status.danger', b: true })]} /> : null}
          {buttons.map((b, i) => <Clickable key={b.key} marginLeft={i === 0 ? 0 : 2} onClick={press(b.send)}><Rich line={[sp(`[${b.key}]`, { c: 'accent.hover', b: true }), sp(' ' + b.label, { c: 'text.secondary' })]} /></Clickable>)}
        </Box>
      ) : null}
    </Box>
  );
}
