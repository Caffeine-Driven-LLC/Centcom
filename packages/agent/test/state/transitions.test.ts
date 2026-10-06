import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AGENT_WIRE_STATES } from '@centcom/protocol';
import { EVENT_STATE_TABLE, TOOL_KIND_STATE, initialCtx, nextState, toolKind, type MachineState, type StateCtx } from '../../src/index.js';
import type { EventBody } from '../../src/types.js';
import { WIRE, ev } from './helpers.js';

const MAP = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../contracts/state-map.json', import.meta.url)), 'utf8')) as Record<string, unknown>;
const step = (c: StateCtx, b: EventBody | { type: string; [k: string]: unknown }, now = 0) => nextState(c, 'tool_id' in b || 'approval_id' in b || b.type.includes('.') || b.type === 'error' ? ev(b as EventBody) : (b as never), now);
const run = (bodies: (EventBody | any)[], plan = false) => { let c = initialCtx({ plan }); const out: MachineState[] = []; for (const b of bodies) { const s = step(c, b); c = s.ctx; out.push(s.state); } return { out, c }; };
const tool = (name: string, id = 't1', command?: string): EventBody => ({ type: 'tool.requested', tool_id: id, name, input_summary: '', risk: 'low', ...(command ? { command } : {}) });

describe('mapping', () => {
  it.each([
    ['Read', undefined, 'read'], ['Grep', undefined, 'search'], ['Glob', undefined, 'search'], ['WebFetch', undefined, 'web'], ['WebSearch', undefined, 'web'], ['Edit', undefined, 'edit'], ['MultiEdit', undefined, 'edit'], ['apply_patch', undefined, 'edit'], ['Write', undefined, 'create'],
    ['Bash', 'npm test', 'command'], ['shell', 'cat README.md', 'read'], ['shell', 'rg foo src', 'search'], ['Bash', 'rm -rf build', 'delete'], ['Bash', 'cd x && rm y', 'command'], ['Task', undefined, 'subagent'], ['BashOutput', undefined, 'background'], ['mcp__github__list', undefined, 'mcp'], ['SomethingNew', undefined, 'other'],
  ])('%s %s is a %s tool', (name, cmd, kind) => { expect(toolKind(name, cmd)).toBe(kind); });
  it('every tool kind maps to a contract agent state', () => { for (const s of Object.values(TOOL_KIND_STATE)) { expect(WIRE.has(s)).toBe(true); expect(s in MAP).toBe(true); } });
  it.each(Object.entries(TOOL_KIND_STATE))('table row for %s exists', (kind, state) => { expect(EVENT_STATE_TABLE.some((r) => r.input === `tool.requested (${kind})` && r.state === state)).toBe(true); });
});

describe('transitions', () => {
  it('a plain turn: prompt-received, thinking, streaming, success', () => {
    expect(run([{ type: 'turn.started', turn_id: 't' }, { type: 'thinking.delta', message_id: 'm', text: '' }, { type: 'text.delta', message_id: 'm', index: 0, text: 'x' }, { type: 'turn.done', outcome: 'ok' }]).out).toEqual(['prompt-received', 'thinking', 'streaming', 'success']);
  });
  it('plan mode thinks as planning', () => { expect(run([{ type: 'turn.started', turn_id: 't' }, { type: 'thinking.delta', message_id: 'm', text: '' }], true).out.at(-1)).toBe('planning'); });
  it('parallel tools: the newest open tool shows; closing it falls back, then to thinking', () => {
    const { out } = run([{ type: 'turn.started', turn_id: 't' }, tool('Read', 'a'), tool('Bash', 'b', 'npm run build'), { type: 'tool.result', tool_id: 'b', status: 'ok', summary: '' }, { type: 'tool.result', tool_id: 'a', status: 'ok', summary: '' }]);
    expect(out.slice(1)).toEqual(['reading-file', 'running-command', 'reading-file', 'thinking']);
  });
  it('closing the older tool first keeps showing the newer one', () => { expect(run([{ type: 'turn.started', turn_id: 't' }, tool('Read', 'a'), tool('Edit', 'b'), { type: 'tool.result', tool_id: 'a', status: 'ok', summary: '' }]).out.at(-1)).toBe('editing-file'); });
  it('approval holds the state, tools starting meanwhile do not override it, and approve/deny show briefly', () => {
    const a = run([{ type: 'turn.started', turn_id: 't' }, tool('Edit', 'e'), { type: 'approval.requested', approval_id: 'apr_1', tool_id: 'e', summary: '', risk: 'high' }, tool('Read', 'r'), { type: 'text.delta', message_id: 'm', index: 0, text: 'x' }]);
    expect(a.out.slice(2)).toEqual(['awaiting-approval', 'awaiting-approval', 'awaiting-approval']);
    expect(step(a.c, { type: 'approval.resolved', approval_id: 'apr_1', decision: 'approve', scope: 'once', by: 'user' }).state).toBe('approved'); expect(step(a.c, { type: 'approval.resolved', approval_id: 'apr_1', decision: 'deny', scope: 'once', by: 'user' }).state).toBe('denied');
  });
  it('question, compaction, warning, errors', () => {
    expect(run([{ type: 'question.asked', question_id: 'q', text: 'x' }]).out).toEqual(['asking-question']); expect(run([{ type: 'compaction.started' }, { type: 'compaction.ended' }]).out).toEqual(['compacting', 'idle']);
    expect(run([{ type: 'engine.warning', code: 'x', text: 'y' }]).out).toEqual(['warning']); expect(run([{ type: 'error', code: 'provider_protocol_error', tool_message: '', fatal: true }]).out).toEqual(['error']);
    const cap = step(initialCtx(), { type: 'error', code: 'provider_cap_reached', tool_message: '', fatal: false }); expect(cap.state).toBe('warning'); expect(cap.effects).toContainEqual({ type: 'hint', hint: 'provider-cap-reached' });
    expect(step(initialCtx(), { type: 'error', code: 'provider_rate_limited', tool_message: '', fatal: false }).effects).toContainEqual({ type: 'hint', hint: 'provider-rate-limited' });
  });
  it('turn.done: ok success, error error, canceled idle; stack cleared', () => {
    for (const [o, s] of [['ok', 'success'], ['error', 'error'], ['canceled', 'idle']] as const) { const r = run([{ type: 'turn.started', turn_id: 't' }, tool('Read'), { type: 'turn.done', outcome: o }]); expect(r.out.at(-1)).toBe(s); expect(r.c.stack).toEqual([]); }
  });
  it('subagents show sub-agent until done', () => { expect(run([{ type: 'turn.started', turn_id: 't' }, { type: 'subagent.started', subagent_id: 's', parent_tool_id: 'p', label: 'x' }, { type: 'subagent.done', subagent_id: 's', status: 'ok' }]).out.slice(1)).toEqual(['sub-agent', 'thinking']); });
  it('test runs: pass and fail from the hint, and deleting from the hint', () => {
    const hints = { isTest: (e: { name: string }) => e.name === 'Bash', deletes: (e: { command?: string }) => !!e.command?.includes('rm') };
    let c = initialCtx(); c = nextState(c, ev({ type: 'turn.started', turn_id: 't' }), 0).ctx; c = nextState(c, ev(tool('Bash', 'b', 'npm test')), 0, hints).ctx; expect(nextState(c, ev({ type: 'tool.result', tool_id: 'b', status: 'ok', summary: '' }), 0, hints).state).toBe('tests-pass'); expect(nextState(c, ev({ type: 'tool.result', tool_id: 'b', status: 'error', summary: '' }), 0, hints).state).toBe('tests-fail');
    expect(nextState(initialCtx(), ev(tool('Bash', 'x', 'rm -rf a')), 0, hints).state).toBe('deleting-file');
  });
  it('signals: crash ends it for good, exit ok/error/canceled, interrupt returns to idle, merge conflict, saving', () => {
    const w = run([{ type: 'turn.started', turn_id: 't' }, tool('Edit')]); const crash = nextState(w.c, { type: 'exited', outcome: 'crash' }, 0); expect(crash.state).toBe('crash'); expect(nextState(crash.ctx, ev({ type: 'text.delta', message_id: 'm', index: 0, text: 'x' }), 1).state).toBe('crash'); expect(nextState(crash.ctx, { type: 'interrupt' }, 1).state).toBe('crash');
    expect(nextState(w.c, { type: 'exited', outcome: 'ok' }, 0).state).toBe('idle'); expect(nextState(w.c, { type: 'exited', outcome: 'error' }, 0).state).toBe('error'); expect(nextState(w.c, { type: 'interrupt' }, 0).state).toBe('idle');
    expect(nextState(initialCtx(), { type: 'merge_conflict' }, 0).state).toBe('merge-conflict'); expect(nextState(initialCtx(), { type: 'saving' }, 0).state).toBe('saving');
  });
  it('unknown events and tools never throw and change nothing / tool-running', () => {
    const c = initialCtx(); for (const t of ['status', 'usage.report', 'limits.report', 'model.changed', 'session.started', 'totally.new']) { const r = nextState(c, { type: t, state: 'x' } as never, 0); expect(r.state).toBe('idle'); expect(r.effects).toEqual([]); }
    expect(nextState(c, ev(tool('BrandNewTool')), 0).state).toBe('tool-running');
  });
});

describe('contract parity', () => {
  it('the agent-level list is a subset of state-map.json, and the two extra states exist there too', () => { for (const s of AGENT_WIRE_STATES) expect(s in MAP, s).toBe(true); expect('prompt-received' in MAP && 'sleeping' in MAP).toBe(true); });
  it('every state the machine can produce is in state-map.json, and the wire ones are agent-level; none of the forbidden families appear', () => {
    const bodies: EventBody[] = [{ type: 'turn.started', turn_id: 't' }, { type: 'thinking.delta', message_id: 'm', text: '' }, { type: 'text.delta', message_id: 'm', index: 0, text: '' }, { type: 'text.done', message_id: 'm' }, tool('Read', 'a'), tool('Grep', 'b'), tool('WebFetch', 'c'), tool('Edit', 'd'), tool('Write', 'e'), tool('Bash', 'f', 'rm x'), tool('Bash', 'g', 'ls'), tool('Task', 'h'), tool('BashOutput', 'i'), tool('mcp__x__y', 'j'), tool('Mystery', 'k'),
      { type: 'tool.result', tool_id: 'a', status: 'ok', summary: '' }, { type: 'tool.result', tool_id: 'b', status: 'error', summary: '' }, { type: 'approval.requested', approval_id: 'apr_1', tool_id: 'a', summary: '', risk: 'low' }, { type: 'approval.resolved', approval_id: 'apr_1', decision: 'approve', scope: 'once', by: 'user' }, { type: 'approval.resolved', approval_id: 'apr_1', decision: 'deny', scope: 'once', by: 'user' },
      { type: 'question.asked', question_id: 'q', text: '' }, { type: 'compaction.started' }, { type: 'compaction.ended' }, { type: 'engine.warning', code: 'c', text: '' }, { type: 'error', code: 'provider_cap_reached', tool_message: '', fatal: false }, { type: 'error', code: 'provider_protocol_error', tool_message: '', fatal: true }, { type: 'subagent.started', subagent_id: 's', parent_tool_id: 'p', label: '' }, { type: 'subagent.done', subagent_id: 's', status: 'ok' },
      { type: 'turn.done', outcome: 'ok' }, { type: 'turn.done', outcome: 'error' }, { type: 'turn.done', outcome: 'canceled' }, { type: 'status', state: 'x' }];
    const sigs = [{ type: 'interrupt' }, { type: 'merge_conflict' }, { type: 'saving' }, { type: 'exited', outcome: 'crash' }, { type: 'exited', outcome: 'ok' }, { type: 'tick', timer: 'dwell', gen: 0 }, { type: 'tick', timer: 'hard', gen: 0 }, { type: 'tick', timer: 'sleep', gen: 0 }];
    const states: MachineState[] = [...AGENT_WIRE_STATES, 'prompt-received', 'sleeping']; const seen = new Set<string>(); let n = 0;
    for (const s of states) for (const turn of [false, true]) for (const plan of [false, true]) for (const input of [...bodies.map((b) => ev(b)), ...sigs] as never[]) { for (const gen of [0, 1]) { const ctx: StateCtx = { ...initialCtx({ plan }), state: s, turn, gen }; const r = nextState(ctx, input, 10); seen.add(r.state); n++; } }
    expect(n).toBeGreaterThan(5000); for (const s of seen) { expect(s in MAP, s).toBe(true); expect(WIRE.has(s) || s === 'prompt-received' || s === 'sleeping', s).toBe(true); }
    for (const bad of ['offline', 'reconnecting', 'rate-limited', 'quota-reached', 'teammate-joins']) expect(seen.has(bad)).toBe(false); expect([...seen].some((s) => s.startsWith('provider-'))).toBe(false);
  });
});
