import React from 'react';
import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import type { NormalisedEvent } from '@centcom/agent';
import { GRACE_MS, PermissionPrompt, approvalFromEvent, approvalFromWire, boxWidth, byExpiry, countdown, createPromptMachine, promptRows, visibleText, type ApprovalDecisionInput, type ApprovalView } from '../../src/permission/index.js';
import { textWidth, type Line } from '../../src/util/text.js';

const text = (l: Line) => l.map((s) => s.t).join(''); const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
const ev = (b: object) => ({ v: 1, seq: 1, ts: 'x', agent_id: 'agt_x', type: 'approval.requested', approval_id: 'apr_1', tool_id: 't', summary: 'npm test', risk: 'low', ...b }) as Extract<NormalisedEvent, { type: 'approval.requested' }>;
const t0 = Date.UTC(2026, 9, 6, 12); const view = (o: Partial<ApprovalView> = {}): ApprovalView => ({ ...approvalFromEvent(ev({ command: 'npm test', cwd: '~/centcom' }), { runsOn: 'Ana', accountLine: 'runs on Ana', branch: 'agent/feature-retry', now: () => new Date(t0) }), ...o });
function machine(o: Partial<ApprovalView> = {}, can = true) { let now = t0; const got: ApprovalDecisionInput[] = []; const edits: string[] = []; const m = createPromptMachine({ view: view(o), canDecide: can, now: () => now, onDecide: (d) => got.push(d), onEdit: (c) => edits.push(c) }); return { m, got, edits, at: (ms: number) => { now = t0 + ms; } }; }

describe('keys', () => {
  it('y once, s session, a always, n and esc deny; keys for scopes that are not allowed do nothing', () => {
    for (const [k, want] of [['y', 'once'], ['s', 'session'], ['a', 'always']] as const) { const r = machine(); r.at(400); r.m.key(k); expect(r.got).toEqual([{ approvalId: 'apr_1', decision: 'approve', scope: want }]); }
    for (const k of ['n', 'escape']) { const r = machine(); r.at(400); r.m.key(k); expect(r.got).toEqual([{ approvalId: 'apr_1', decision: 'deny', scope: 'once', reason: 'user' }]); }
    const only = machine({ allowedScopes: ['once'] }); only.at(400); only.m.key('a'); only.m.key('s'); expect(only.got).toEqual([]); only.m.key('y'); expect(only.got).toHaveLength(1); only.m.key('y'); expect(only.got).toHaveLength(1);
  });
  it('keys within 300 ms of appearing are ignored', () => { const r = machine(); r.at(100); r.m.key('y'); expect(r.got).toEqual([]); r.at(GRACE_MS); r.m.key('y'); expect(r.got).toHaveLength(1); });
  it('edit is offered only when editable; the edited command comes back approved once', () => {
    const no = machine({ editable: false }); no.at(400); no.m.key('e'); expect(no.edits).toEqual([]); const yes = machine({ editable: true }); yes.at(400); yes.m.key('e'); expect(yes.edits).toEqual(['npm test']); yes.m.setEdited('npm test -- --run'); expect(yes.got).toEqual([{ approvalId: 'apr_1', decision: 'approve', scope: 'once', editedCommand: 'npm test -- --run' }]);
  });
  it('a risky one needs y then Enter within 5 s; anything else cancels the confirmation', () => {
    const r = machine({ risk: 'high' }); r.at(400); r.m.key('y'); expect(r.got).toEqual([]); expect(r.m.state()).toMatchObject({ phase: 'confirming', message: 'Type y then Enter to confirm.' }); r.at(1000); r.m.key('return'); expect(r.got).toEqual([{ approvalId: 'apr_1', decision: 'approve', scope: 'once' }]);
    const late = machine({ destructive: true }); late.at(400); late.m.key('y'); late.at(6000); late.m.key('return'); expect(late.got).toEqual([]); const other = machine({ risk: 'high' }); other.at(400); other.m.key('y'); other.m.key('x'); expect(other.m.state().phase).toBe('active'); other.m.key('return'); expect(other.got).toEqual([]);
  });
  it('at the expiry time it denies with reason expired, once, and shows Expired', () => {
    const r = machine(); r.at(5 * 60_000 - 1000); expect(r.m.tick().phase).toBe('active'); r.at(5 * 60_000); expect(r.m.tick()).toMatchObject({ phase: 'expired', message: 'Expired' }); r.m.tick(); expect(r.got).toEqual([{ approvalId: 'apr_1', decision: 'deny', scope: 'once', reason: 'expired' }]); r.m.key('y'); expect(r.got).toHaveLength(1);
  });
  it('someone who cannot decide has no keys', () => { const r = machine({}, false); r.at(400); r.m.key('y'); r.m.key('n'); expect(r.got).toEqual([]); });
});

describe('model', () => {
  it('the same request from two engines differs only in the badge and the command', () => {
    const a = approvalFromEvent(ev({ command: 'ls' }), { runsOn: 'Ana', accountLine: 'runs on Ana', engine: 'claude-code', now: () => new Date(t0) }); const b = approvalFromEvent(ev({ command: 'ls -la' }), { runsOn: 'Ana', accountLine: 'runs on Ana', engine: 'codex', now: () => new Date(t0) });
    expect({ ...a, engine: '', provider: '', command: '' }).toEqual({ ...b, engine: '', provider: '', command: '' }); expect([a.provider, b.provider]).toEqual(['anthropic', 'openai']); expect(a.title).toBe('Allow Cento to run this command?'); expect(approvalFromEvent(ev({ path: 'src/a.ts', command: undefined }), { runsOn: 'x', accountLine: 'y' }).title).toContain('src/a.ts');
  });
  it('the shared-session form carries ids, risk, expiry and text', () => { const v = approvalFromWire({ approval_id: 'apr_2', agent_id: 'agt_1', risk: 'high', expires_at: '2026-10-06T12:05:00.000Z', approver: 'owner' }, { summary: 's', command: 'rm x', cwd: '/w' }, { runsOn: 'Ben', accountLine: "Runs on Ben's account" }); expect(v).toMatchObject({ approvalId: 'apr_2', destructive: true, approver: 'owner', command: 'rm x', directory: '/w' }); });
  it('hidden characters in a command are shown as escapes so you see what will run', () => {
    expect(visibleText('echo hi‮ dcba')).toBe('echo hi\\u202e dcba'); expect(visibleText('a​b')).toBe('a\\u200bb'); expect(visibleText('x\u001b[2Jy')).toBe('x\\x1b[2Jy'); expect(visibleText('plain é 日本')).toBe('plain é 日本'); expect(visibleText('a\tb\nc')).toBe('a\tb\nc'); /* tabs and newlines are shown as they are */
  });
  it('a queue is ordered by expiry; countdown is m:ss', () => { const a = view({ approvalId: 'a', expiresAt: '2026-10-06T12:10:00Z' }); const b = view({ approvalId: 'b', expiresAt: '2026-10-06T12:01:00Z' }); expect([a, b].sort(byExpiry).map((x) => x.approvalId)).toEqual(['b', 'a']); expect([countdown(272_000), countdown(0), countdown(61_000)]).toEqual(['4:32', '0:00', '1:01']); });
});

describe('rendering', () => {
  const rows = (o: Partial<ApprovalView> = {}, extra: Partial<Parameters<typeof promptRows>[1]> = {}) => promptRows(view(o), { width: 76, canDecide: true, onEdit: false, remainingMs: 272_000, phase: 'active', ...extra }).map(text);
  it('shows the title, command, place, badge line, countdown and the key row', () => {
    const r = rows(); expect(r[0]).toBe('Allow Cento to run this command?'); expect(r[1]).toBe('  npm test'); expect(r).toContain('in ~/centcom (agent/feature-retry)'); expect(r.some((l) => l.startsWith('claude-code · anthropic · runs on Ana'))).toBe(true); expect(r.some((l) => l.includes('expires in 4:32'))).toBe(true); expect(r.at(-1)).toBe('[y] yes  [s] this session  [a] always  [n] no');
  });
  it('long commands show 6 lines and a note; only allowed keys and edit when possible are listed', () => {
    const r = rows({ command: Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n') }); expect(r.filter((l) => l.startsWith('  line '))).toHaveLength(6); expect(r).toContain('  ⋯ +4 lines (v to view all)');
    expect(rows({ allowedScopes: ['once'] }).at(-1)).toBe('[y] yes  [n] no'); expect(rows({ editable: true }, { onEdit: true }).at(-1)).toContain('[e] edit'); expect(rows({ editable: true }, { onEdit: false }).at(-1)).not.toContain('[e]');
  });
  it('cannot decide: no key row, "Waiting for <name> to decide."; command post account line is shown', () => {
    const r = rows({ accountLine: "Runs on Ana's account" }, { canDecide: false, hostName: 'Ana' }); expect(r.at(-1)).toBe('Waiting for Ana to decide.'); expect(r.join('\n')).not.toContain('[y]'); expect(r.join('\n')).toContain("Runs on Ana's account");
  });
  it('risk is stated in words; the box is min(cols-2, 78) wide; a destructive prompt has the heavy border', () => {
    expect(rows({ risk: 'high' }).join('\n')).toContain('high risk'); expect([boxWidth(80), boxWidth(120), boxWidth(50)]).toEqual([78, 78, 48]);
    const out = strip(renderToString(<PermissionPrompt request={view({ risk: 'high' })} canDecide onDecide={() => undefined} now={() => new Date(t0)} cols={80} />, { columns: 80 })).split('\n').filter(Boolean); expect(out[0]).toMatch(/^┏━+┓$/); expect(Math.max(...out.map(textWidth))).toBe(78);
    expect(strip(renderToString(<PermissionPrompt request={view()} canDecide onDecide={() => undefined} now={() => new Date(t0)} cols={80} />, { columns: 80 })).split('\n')[0]).toMatch(/^╭─+╮$/);
  });
});
