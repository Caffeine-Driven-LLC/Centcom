import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { initialCtx, nextState, EventStreamValidator, type MachineState, type StateCtx } from '../../src/index.js';
import type { EventBody } from '../../src/types.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ev } from './helpers.js';

const MAP = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../contracts/state-map.json', import.meta.url)), 'utf8')) as Record<string, unknown>;

/** Lane C014: random but legal streams (the stream validator accepts every one of them, and so does the machine) never break the machine's promises. */
type Step = { k: 'text' } | { k: 'think' } | { k: 'tool'; name: string; cmd?: string } | { k: 'result'; status: 'ok' | 'error' | 'denied' | 'canceled' } | { k: 'approve'; decision: 'approve' | 'deny' } | { k: 'ask' } | { k: 'sub' } | { k: 'subdone' } | { k: 'warn' } | { k: 'turn'; outcome: 'ok' | 'error' | 'canceled' } | { k: 'interrupt' } | { k: 'tick'; timer: 'dwell' | 'hard' | 'sleep' };
const step: fc.Arbitrary<Step> = fc.oneof(
  fc.constant<Step>({ k: 'text' }), fc.constant<Step>({ k: 'think' }), fc.constant<Step>({ k: 'ask' }), fc.constant<Step>({ k: 'sub' }), fc.constant<Step>({ k: 'subdone' }), fc.constant<Step>({ k: 'warn' }), fc.constant<Step>({ k: 'interrupt' }),
  fc.record({ k: fc.constant('tool' as const), name: fc.constantFrom('Read', 'Edit', 'Write', 'Grep', 'WebFetch', 'Task', 'Bash', 'mystery-tool'), cmd: fc.option(fc.constantFrom('npm test', 'rm -rf x', 'ls', 'git status'), { nil: undefined }) }),
  fc.record({ k: fc.constant('result' as const), status: fc.constantFrom<'ok' | 'error' | 'denied' | 'canceled'>('ok', 'error', 'denied', 'canceled') }), fc.record({ k: fc.constant('approve' as const), decision: fc.constantFrom<'approve' | 'deny'>('approve', 'deny') }),
  fc.record({ k: fc.constant('turn' as const), outcome: fc.constantFrom<'ok' | 'error' | 'canceled'>('ok', 'error', 'canceled') }), fc.record({ k: fc.constant('tick' as const), timer: fc.constantFrom<'dwell' | 'hard' | 'sleep'>('dwell', 'hard', 'sleep') }),
);

/** Turns the steps into events a real engine could produce (tools and approvals opened before they are answered, one turn at a time). */
function legalise(steps: Step[]): (EventBody | { type: 'tick'; timer: 'dwell' | 'hard' | 'sleep'; gen: number } | { type: 'interrupt' })[] {
  const out: (EventBody | any)[] = [{ type: 'session.started', engine: 'fake', engine_session_id: 's', model: 'm', cli_version: '1', tools: [], mcp_servers: [], capabilities: [], login_kind: 'unknown' }];
  let inTurn = false; let n = 0; const tools: string[] = []; const approvals: string[] = []; const subs: string[] = []; const closeTurn = (outcome: 'ok' | 'error' | 'canceled') => { for (const a of approvals.splice(0)) out.push({ type: 'approval.resolved', approval_id: a, decision: 'deny', by: 'user' }); for (const t of tools.splice(0)) out.push({ type: 'tool.result', tool_id: t, status: 'canceled', summary: '' }); for (const s of subs.splice(0)) out.push({ type: 'subagent.done', subagent_id: s, status: 'canceled' }); out.push({ type: 'turn.done', outcome }); inTurn = false; };
  const open = () => { if (!inTurn) { out.push({ type: 'turn.started', turn_id: 'trn_' + ++n }); inTurn = true; } };
  for (const s of steps) {
    switch (s.k) {
      case 'text': open(); { const m = 'm' + ++n; out.push({ type: 'text.delta', message_id: m, index: 0, text: 'x' }, { type: 'text.done', message_id: m }); } break;
      case 'think': open(); out.push({ type: 'thinking.delta', message_id: 'th' + n, text: '…' }); break;
      case 'tool': open(); { const id = 't' + ++n; tools.push(id); out.push({ type: 'tool.requested', tool_id: id, name: s.name, input_summary: '', risk: 'low', ...(s.cmd ? { command: s.cmd } : {}) }); } break;
      case 'result': { const id = tools.shift(); if (id) out.push({ type: 'tool.result', tool_id: id, status: s.status, summary: '' }); } break;
      case 'approve': open(); if (approvals.length && (n & 1)) { out.push({ type: 'approval.resolved', approval_id: approvals.shift()!, decision: s.decision, by: 'user' }); } else { const id = 'a' + ++n; approvals.push(id); out.push({ type: 'approval.requested', approval_id: id, tool_id: tools[0] ?? 'none', summary: '', risk: 'medium' }); } break;
      case 'ask': open(); out.push({ type: 'question.asked', question_id: 'q' + ++n, text: '?' } as EventBody); break;
      case 'sub': open(); { const id = 's' + ++n; subs.push(id); out.push({ type: 'subagent.started', subagent_id: id, parent_tool_id: 'p', label: 'x' }); } break;
      case 'subdone': { const id = subs.shift(); if (id) out.push({ type: 'subagent.done', subagent_id: id, status: 'ok' }); } break;
      case 'warn': open(); out.push({ type: 'engine.warning', code: 'c', text: 't' }); break;
      case 'turn': if (inTurn) closeTurn(s.outcome); break;
      case 'interrupt': if (inTurn) { closeTurn('canceled'); } out.push({ type: 'interrupt' }); break;
      case 'tick': out.push({ type: 'tick', timer: s.timer, gen: -1 }); break;
    }
  }
  if (inTurn) closeTurn('ok'); return out;
}

describe('the state machine under random legal streams (lane C014)', () => {
  it('the stream is legal, every state is on the contract list, no throw, and the end of a turn always leaves a calm state', () => {
    fc.assert(fc.property(fc.array(step, { minLength: 1, maxLength: 60 }), (steps) => {
      const evs = legalise(steps); const v = new EventStreamValidator('fake'); let seq = 0; let ctx: StateCtx = initialCtx(); let lastTurnDone = false;
      for (const b of evs) {
        const isSignal = b.type === 'tick' || b.type === 'interrupt'; const input = isSignal ? (b.type === 'tick' ? { type: 'tick' as const, timer: b.timer, gen: ctx.gen } : { type: 'interrupt' as const }) : ev(b, ++seq);
        if (!isSignal) v.check(input as never); const s = nextState(ctx, input as never, 1000 * seq); ctx = s.ctx;
        expect(s.state in MAP, `${b.type} -> ${s.state}`).toBe(true); expect(ctx.state).toBe(s.state);
        if (b.type === 'interrupt') expect(s.state).toBe('idle'); lastTurnDone = b.type === 'turn.done';
        if (lastTurnDone) expect((['success', 'error', 'idle'] as MachineState[]).includes(s.state), s.state).toBe(true);
        if (ctx.approvals.length && !['interrupt', 'turn.done', 'approval.resolved'].includes(b.type)) expect(s.state).toBe('awaiting-approval'); // an open approval is never displaced
      }
      v.end(); expect(ctx.stack).toEqual([]); expect(ctx.approvals).toEqual([]);
    }), { numRuns: 400 });
  });
  it('after a crash nothing moves it, whatever comes next', () => {
    fc.assert(fc.property(fc.array(step, { maxLength: 30 }), fc.array(step, { maxLength: 30 }), (a, b) => {
      let ctx: StateCtx = initialCtx(); let seq = 0; for (const e of legalise(a)) { if (e.type === 'tick' || e.type === 'interrupt') continue; ctx = nextState(ctx, ev(e, ++seq), seq).ctx; }
      ctx = nextState(ctx, { type: 'exited', outcome: 'crash' }, 5).ctx; expect(ctx.state).toBe('crash');
      for (const e of legalise(b)) { if (e.type === 'tick' || e.type === 'interrupt') continue; const s = nextState(ctx, ev(e, ++seq), seq + 10); expect(s.state).toBe('crash'); ctx = s.ctx; }
    }), { numRuns: 100 });
  });
});
