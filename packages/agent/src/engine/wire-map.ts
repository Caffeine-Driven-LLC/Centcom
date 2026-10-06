/** Normalised engine events -> session wire events (CT-WS-SESSION-EVENTS). Pure. Model names, engine ids, versions and paths never go in a clear part. */
import type { NormalisedEvent, Risk } from '../types.js';

export interface WireOut { k: string; p?: Record<string, unknown>; ct?: Record<string, unknown> }
export interface WireContext {
  agentId: string;
  /** Engine message ids are free-form; the wire wants `msg_` ULIDs. The caller memoises (same engine id, same wire id). */
  messageId(engineMessageId: string): string;
  approverFor(risk: Risk): 'host' | 'owner' | 'any_editor';
  approvalTtlMs: number; now(): Date;
  debug?(msg: string, ctx?: Record<string, unknown>): void;
}
export interface EngineExit { agent_id: string; outcome: 'ok' | 'error' | 'canceled'; error_code?: string }

export function toSessionWire(ev: NormalisedEvent, c: WireContext): WireOut[] {
  switch (ev.type) {
    case 'text.delta': return [{ k: 'message.assistant.delta', ct: { agent_id: c.agentId, message_id: c.messageId(ev.message_id), index: ev.index, delta: ev.text } }];
    case 'text.done': return [{ k: 'message.assistant.done', ct: { agent_id: c.agentId, message_id: c.messageId(ev.message_id), ...(ev.input_tokens !== undefined ? { input_tokens: ev.input_tokens } : {}), ...(ev.output_tokens !== undefined ? { output_tokens: ev.output_tokens } : {}) } }];
    case 'tool.requested': return [{ k: 'tool.request', ct: { agent_id: c.agentId, tool_id: ev.tool_id, name: ev.name, input_summary: ev.input_summary, risk: ev.risk } }];
    case 'approval.requested': return [{ k: 'approval.request', p: { approval_id: ev.approval_id, agent_id: c.agentId, risk: ev.risk, expires_at: new Date(c.now().getTime() + c.approvalTtlMs).toISOString(), approver: c.approverFor(ev.risk) }, ct: { summary: ev.summary, ...(ev.command ? { command: ev.command } : {}), ...(ev.cwd ? { cwd: ev.cwd } : {}) } }];
    // a timeout or an interrupt is answered locally (the tool result says denied); only a person or a policy decision is a wire event
    case 'approval.resolved': return ev.by === 'user' || ev.by === 'policy' ? [{ k: 'approval.decision', p: { approval_id: ev.approval_id, decision: ev.decision, scope: ev.scope } }] : [];
    case 'tool.result': return [{ k: 'tool.result', ct: { agent_id: c.agentId, tool_id: ev.tool_id, status: ev.status, summary: ev.summary } }];
    case 'error': return [{ k: 'message.system', ct: { level: 'error', text: `provider_error:${ev.code}` } }];
    case 'model.changed': return [{ k: 'message.system', ct: { level: 'info', text: `model_changed:${ev.model}` } }];
    // `agent.state` is NOT produced here: the state machine's emitter (C014) is its only owner (de-duplication, 2/s cap)
    default: return []; // status, subagent.started, session.started, thinking.delta, usage.report, turn.*, subagent.text/done, warnings, questions: local only
  }
}
export const exitToWire = (x: EngineExit): WireOut => ({ k: 'agent.exit', p: { agent_id: x.agent_id, outcome: x.outcome, ...(x.error_code ? { error_code: x.error_code.slice(0, 200) } : {}) } });
