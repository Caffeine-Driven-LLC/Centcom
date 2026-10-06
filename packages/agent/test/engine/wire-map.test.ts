import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AGENT_WIRE_STATES, EVENT_MODES, parseEventPayload, parseSecretPayload } from '@centcom/protocol';
import { exitToWire, toSessionWire, type WireContext, type WireOut } from '../../src/index.js';
import type { EventBody } from '../../src/types.js';
import { AGT, APR, mk } from './helpers.js';

const MSG = 'msg_01JTEST0000000000000000001'; const ids = new Map<string, string>();
const ctx = (o: Partial<WireContext> = {}): WireContext => ({ agentId: AGT, messageId: (m) => { if (!ids.has(m)) ids.set(m, `msg_01JTEST00000000000000000${String(ids.size + 1).padStart(2, '0')}`); return ids.get(m)!; }, approverFor: (r) => (r === 'high' ? 'host' : 'any_editor'), approvalTtlMs: 600_000, now: () => new Date('2026-10-06T12:00:00.000Z'), ...o });
const ALL: EventBody[] = [
  { type: 'session.started', engine: 'claude-code', engine_session_id: 's', model: 'claude-x', cli_version: '2.1.0', tools: [], mcp_servers: [], capabilities: [], login_kind: 'subscription' }, { type: 'turn.started', turn_id: 't' },
  { type: 'text.delta', message_id: 'm1', index: 0, text: 'hello' }, { type: 'text.done', message_id: 'm1', text: 'hello', input_tokens: 3, output_tokens: 2 }, { type: 'thinking.delta', message_id: 'm1', text: 'hmm' },
  { type: 'tool.requested', tool_id: 'tu_1', name: 'Bash', input_summary: 'npm test', risk: 'medium', command: 'npm test', path: '/secret/path' }, { type: 'approval.requested', approval_id: APR, tool_id: 'tu_1', summary: 'run tests', command: 'npm test', cwd: '/home/u/proj', risk: 'high' },
  { type: 'approval.resolved', approval_id: APR, decision: 'approve', scope: 'once', by: 'user' }, { type: 'approval.resolved', approval_id: APR, decision: 'deny', scope: 'session', by: 'policy' }, { type: 'approval.resolved', approval_id: APR, decision: 'deny', scope: 'once', by: 'timeout' }, { type: 'approval.resolved', approval_id: APR, decision: 'deny', scope: 'once', by: 'interrupt' },
  { type: 'tool.result', tool_id: 'tu_1', status: 'ok', summary: 'ok' }, { type: 'tool.result', tool_id: 'tu_1', status: 'denied', summary: 'denied' }, { type: 'subagent.started', subagent_id: 's1', parent_tool_id: 'tu_1', label: 'x' }, { type: 'subagent.text', subagent_id: 's1', text: 'x' }, { type: 'subagent.done', subagent_id: 's1', status: 'ok' },
  { type: 'usage.report', input_tokens: 1, output_tokens: 1, cost_is_estimate: true } as never, { type: 'model.changed', model: 'claude-y', reason: 'user' }, { type: 'status', state: 'thinking' }, { type: 'status', state: 'prompt-received' }, { type: 'status', state: 'provider-cap-reached' }, { type: 'status', state: 'something-from-the-future' },
  { type: 'error', code: 'provider_rate_limited', tool_message: 'slow down', fatal: false }, { type: 'turn.done', outcome: 'ok' }, { type: 'engine.warning', code: 'x', text: 'y' }, { type: 'question.asked', question_id: 'q', text: 'z' },
];
const outs = (b: EventBody) => toSessionWire(mk(b, 1), ctx());
const valid = (o: WireOut) => { if (o.p) expect(parseEventPayload(o.k, o.p).ok, `${o.k} clear part ${JSON.stringify(o.p)}`).toBe(true); if (o.ct) expect(parseSecretPayload(o.k, o.ct).ok, `${o.k} secret part ${JSON.stringify(o.ct)}`).toBe(true); };

describe('toSessionWire', () => {
  it('every produced clear part and secret part validates against the contract schema', () => { let n = 0; for (const b of ALL) for (const o of outs(b)) { valid(o); n++; } expect(n).toBeGreaterThan(10); });
  it('an encrypted kind never carries a clear part, and a clear kind never carries a secret part', () => {
    for (const b of ALL) for (const o of outs(b)) { const mode = (EVENT_MODES as Record<string, string>)[o.k]; expect(mode, o.k).toBeDefined(); if (mode === 'encrypted') expect(o.p, o.k).toBeUndefined(); if (mode === 'clear') expect(o.ct, o.k).toBeUndefined(); if (mode === 'hybrid') expect(o.p, o.k).toBeTruthy(); if (o.k === 'approval.request') expect(o.ct).toBeTruthy(); }
  });
  it('the mapping rows', () => {
    expect(outs(ALL[2]!)).toEqual([{ k: 'message.assistant.delta', ct: { agent_id: AGT, message_id: expect.stringMatching(/^msg_/), index: 0, delta: 'hello' } }]);
    expect(outs(ALL[3]!)[0]).toMatchObject({ k: 'message.assistant.done', ct: { input_tokens: 3, output_tokens: 2 } }); expect(outs(ALL[5]!)).toEqual([{ k: 'tool.request', ct: { agent_id: AGT, tool_id: 'tu_1', name: 'Bash', input_summary: 'npm test', risk: 'medium' } }]);
    expect(outs(ALL[6]!)[0]).toMatchObject({ k: 'approval.request', p: { approval_id: APR, agent_id: AGT, risk: 'high', approver: 'host', expires_at: '2026-10-06T12:10:00.000Z' }, ct: { summary: 'run tests', command: 'npm test', cwd: '/home/u/proj' } });
    expect(outs(ALL[7]!)).toEqual([{ k: 'approval.decision', p: { approval_id: APR, decision: 'approve', scope: 'once' } }]); expect(outs(ALL[8]!)).toHaveLength(1); expect(outs(ALL[9]!)).toEqual([]); expect(outs(ALL[10]!)).toEqual([]);
    expect(outs(ALL[11]!)[0]).toMatchObject({ k: 'tool.result', ct: { status: 'ok' } }); expect(outs(ALL[13]!)[0]).toMatchObject({ k: 'agent.state', p: { state: 'sub-agent' } }); expect(outs(ALL[14]!)).toEqual([]); expect(outs(ALL[15]!)).toEqual([]);
    expect(outs(ALL[17]!)[0]).toMatchObject({ k: 'message.system', ct: { level: 'info' } }); expect(outs(ALL[22]!)[0]).toEqual({ k: 'message.system', ct: { level: 'error', text: 'provider_error:provider_rate_limited' } });
  });
  it('local-only events produce nothing', () => { for (const i of [0, 1, 4, 14, 15, 16, 23, 24, 25]) expect(outs(ALL[i]!), String(ALL[i]!.type)).toEqual([]); });
  it('provider-* states stay local; agent-level states pass; others become thinking (and are logged at debug)', () => {
    const logs: string[] = []; const c = ctx({ debug: (m) => logs.push(m) }); const st = (s: string) => toSessionWire(mk({ type: 'status', state: s }, 1), c);
    expect(st('provider-cap-reached')).toEqual([]); expect(st('editing-file')[0]!.p).toMatchObject({ state: 'editing-file' }); expect(st('prompt-received')[0]!.p).toMatchObject({ state: 'thinking' }); expect(st('future-state')[0]!.p).toMatchObject({ state: 'thinking' }); expect(logs).toHaveLength(2);
  });
  it('model names, engine ids, versions and paths never appear in a clear part', () => {
    const clear = JSON.stringify(ALL.flatMap((b) => outs(b).map((o) => o.p ?? {}))); for (const s of ['claude-x', 'claude-y', 'claude-code', '2.1.0', '/secret/path', '/home/u/proj', 'npm test']) expect(clear, s).not.toContain(s);
  });
  it('the same engine message id always maps to the same wire id', () => { const c = ctx(); const a = toSessionWire(mk({ type: 'text.delta', message_id: 'zz', index: 0, text: 'a' }, 1), c)[0]!.ct!.message_id; const b = toSessionWire(mk({ type: 'text.done', message_id: 'zz' }, 2), c)[0]!.ct!.message_id; expect(a).toBe(b); expect(a).not.toBe(MSG); });
  it('exitToWire builds agent.exit and validates', () => { const o = exitToWire({ agent_id: AGT, outcome: 'error', error_code: 'provider_protocol_error' }); expect(o).toEqual({ k: 'agent.exit', p: { agent_id: AGT, outcome: 'error', error_code: 'provider_protocol_error' } }); valid(o); expect(exitToWire({ agent_id: AGT, outcome: 'ok' }).p).toEqual({ agent_id: AGT, outcome: 'ok' }); });
  it('property: random status sequences never produce an agent.state outside the agent-level list', () => {
    fc.assert(fc.property(fc.array(fc.oneof(fc.constantFrom(...AGENT_WIRE_STATES, 'prompt-received', 'sleeping', 'provider-auth-required', 'offline', 'x'), fc.string()), { maxLength: 40 }), (states) => {
      for (const s of states) for (const o of toSessionWire(mk({ type: 'status', state: s }, 1), ctx())) { expect(o.k).toBe('agent.state'); expect((AGENT_WIRE_STATES as readonly string[]).includes(o.p!.state as string)).toBe(true); valid(o); }
    }), { numRuns: 200 });
  });
});
