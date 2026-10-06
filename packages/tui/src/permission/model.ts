/** What a permission prompt shows and what it answers. Built from the normalised `approval.requested` event of either engine, or from a shared session's `approval.request`. */
import type { NormalisedEvent } from '@centcom/agent';

export type Scope = 'once' | 'session' | 'always';
export interface ApprovalView {
  approvalId: string; agentId: string; agentLabel: string; ownerName: string; ownerSlot: number; engine: 'claude-code' | 'codex'; provider: 'anthropic' | 'openai' | 'other';
  runsOn: string; accountLine: string; risk: 'low' | 'medium' | 'high'; destructive: boolean; editable: boolean; allowedScopes: Scope[]; expiresAt: string; approver: 'host' | 'owner' | 'any_editor';
  title: string; command?: string; path?: string; directory?: string; branch?: string; diff?: string;
}
export interface ApprovalDecisionInput { approvalId: string; decision: 'approve' | 'deny'; scope: Scope; editedCommand?: string; reason?: 'user' | 'expired' | 'interrupted' }
export type ApprovedEvent = Extract<NormalisedEvent, { type: 'approval.requested' }>;
const VERB: Record<string, string> = { Bash: 'run', Edit: 'edit', Write: 'write', MultiEdit: 'edit', Read: 'read', WebFetch: 'fetch', shell: 'run', apply_patch: 'edit' };

export function approvalFromEvent(ev: ApprovedEvent, ctx: { runsOn: string; accountLine: string; engine?: ApprovalView['engine']; agentLabel?: string; ownerName?: string; ownerSlot?: number; expiresInMs?: number; now?: () => Date; editable?: boolean; allowedScopes?: Scope[]; branch?: string }): ApprovalView {
  const engine = ctx.engine ?? 'claude-code'; const object = ev.command ?? ev.path ?? ev.summary; const verb = VERB[(ev as unknown as { tool?: string }).tool ?? ''] ?? (ev.command ? 'run' : ev.path ? 'edit' : 'use');
  return { approvalId: ev.approval_id, agentId: ev.agent_id, agentLabel: ctx.agentLabel ?? 'Cento', ownerName: ctx.ownerName ?? 'you', ownerSlot: ctx.ownerSlot ?? 0, engine, provider: engine === 'codex' ? 'openai' : 'anthropic', runsOn: ctx.runsOn, accountLine: ctx.accountLine,
    risk: ev.risk, destructive: ev.risk === 'high', editable: ctx.editable ?? false, allowedScopes: ctx.allowedScopes ?? ['once', 'session', 'always'], expiresAt: new Date((ctx.now?.() ?? new Date()).getTime() + (ctx.expiresInMs ?? 5 * 60_000)).toISOString(), approver: 'host',
    title: `Allow Cento to ${verb} ${verb === 'run' ? 'this command' : object.slice(0, 60)}?`, ...(ev.command ? { command: ev.command } : {}), ...(ev.path ? { path: ev.path } : {}), ...(ev.cwd ? { directory: ev.cwd } : {}), ...(ctx.branch ? { branch: ctx.branch } : {}), ...(ev.diff ? { diff: ev.diff } : {}) };
}
/** The shared-session form: the clear part has the ids, risk and expiry; the secret part has the text. */
export function approvalFromWire(c: { approval_id: string; agent_id: string; risk: ApprovalView['risk']; expires_at: string; approver?: ApprovalView['approver'] }, s: { summary: string; command?: string; cwd?: string }, ctx: { runsOn: string; accountLine: string; engine?: ApprovalView['engine']; agentLabel?: string; ownerName?: string; ownerSlot?: number }): ApprovalView {
  return { approvalId: c.approval_id, agentId: c.agent_id, agentLabel: ctx.agentLabel ?? 'Cento', ownerName: ctx.ownerName ?? 'someone', ownerSlot: ctx.ownerSlot ?? 0, engine: ctx.engine ?? 'claude-code', provider: ctx.engine === 'codex' ? 'openai' : 'anthropic', runsOn: ctx.runsOn, accountLine: ctx.accountLine, risk: c.risk, destructive: c.risk === 'high', editable: false, allowedScopes: ['once', 'session'], expiresAt: c.expires_at, approver: c.approver ?? 'host', title: `Allow Cento to ${s.command ? 'run this command' : 'continue'}?`, ...(s.command ? { command: s.command } : {}), ...(s.cwd ? { directory: s.cwd } : {}) };
}
/** What will really run, visible: bidirectional controls, zero-width characters and escape sequences are shown as `\uXXXX` / `\x1b`. */
export function visibleText(s: string): string {
  return s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, (c) => { const n = c.charCodeAt(0); return n < 0x100 ? `\\x${n.toString(16).padStart(2, '0')}` : `\\u${n.toString(16).padStart(4, '0')}`; });
}
/** Order for a queue: soonest to expire first. */
export const byExpiry = (a: ApprovalView, b: ApprovalView): number => Date.parse(a.expiresAt) - Date.parse(b.expiresAt);
export const countdown = (ms: number): string => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
