/** A pure reducer: normalised engine events and runner signals in, contract state names out. It never sees raw CLI output. */
import type { NormalisedEvent } from '../types.js';
import { DWELL_MS, SLEEP_MS, THINKING_HARD_MS, TOOL_KIND_STATE, toolKind, type MachineState } from './mapping.js';

export interface Open { id: string; state: MachineState; test: boolean }
export interface StateCtx { state: MachineState; since: number; stack: Open[]; /** ids of approvals still open: while any is, the state stays awaiting-approval */ approvals: string[]; turn: boolean; plan: boolean; gen: number; dead: boolean }
export type TimerName = 'dwell' | 'hard' | 'sleep';
export type LocalHint = 'provider-cap-reached' | 'provider-rate-limited';
export type Effect = { type: 'timer'; timer: TimerName; ms: number; gen: number } | { type: 'hint'; hint: LocalHint };
export type RunnerSignal =
  | { type: 'exited'; outcome: 'ok' | 'error' | 'canceled' | 'crash' } | { type: 'interrupt' } | { type: 'tick'; timer: TimerName; gen: number }
  | { type: 'merge_conflict' } | { type: 'saving' };
/** Facts from the command classifier (C016), when it exists. */
export interface HintSource { isTest?(e: { tool_id: string; name: string; command?: string }): boolean; deletes?(e: { tool_id: string; name: string; command?: string }): boolean }
export interface Step { state: MachineState; ctx: StateCtx; effects: Effect[] }

export const initialCtx = (o: { plan?: boolean; now?: number } = {}): StateCtx => ({ state: 'idle', since: o.now ?? 0, stack: [], approvals: [], turn: false, plan: !!o.plan, gen: 0, dead: false });

function timerFor(state: MachineState): { timer: TimerName; ms: number } | undefined {
  if (state in DWELL_MS) return { timer: 'dwell', ms: DWELL_MS[state as keyof typeof DWELL_MS] };
  if (state === 'thinking' || state === 'planning') return { timer: 'hard', ms: THINKING_HARD_MS };
  if (state === 'idle') return { timer: 'sleep', ms: SLEEP_MS };
  return undefined;
}

export function nextState(cur: StateCtx, input: NormalisedEvent | RunnerSignal, now: number, hints?: HintSource): Step {
  const effects: Effect[] = []; let c: StateCtx = { ...cur, stack: [...cur.stack], approvals: [...cur.approvals] }; let free = false; // free: this input may leave awaiting-approval
  const none = (): Step => ({ state: cur.state, ctx: cur, effects: [] });
  if (cur.dead) return none();
  const settle = (): MachineState => c.approvals.length ? 'awaiting-approval' : c.stack.at(-1)?.state ?? (c.turn ? (c.plan ? 'planning' : 'thinking') : 'idle');
  /** Enter a state (or re-arm its timer when it is the same one). */
  const go = (s: MachineState, force = false) => {
    if (c.approvals.length && s !== 'awaiting-approval' && !free) return; // an open approval is never displaced, only resolved, ended, interrupted or exited
    if (s === c.state && !force) return; c = { ...c, state: s === c.state ? c.state : s, since: s === cur.state ? c.since : now, gen: c.gen + 1 };
    const t = timerFor(s); if (t) effects.push({ type: 'timer', timer: t.timer, ms: t.ms, gen: c.gen });
  };
  const show = () => go(settle());

  switch (input.type) {
    case 'turn.started': c = { ...c, turn: true, stack: [] }; go('prompt-received', true); break;
    case 'thinking.delta': if (c.stack.length) break; go(c.plan ? 'planning' : 'thinking', true); break;
    case 'text.delta': go('streaming'); break;
    case 'tool.requested': {
      const kind = hints?.deletes?.(input) ? 'delete' : toolKind(input.name, input.command); const st: MachineState = TOOL_KIND_STATE[kind] ?? 'tool-running';
      c.stack.push({ id: input.tool_id, state: st, test: !!hints?.isTest?.(input) && kind === 'command' }); show(); break;
    }
    case 'tool.result': {
      const i = c.stack.findIndex((o) => o.id === input.tool_id); const open = i >= 0 ? c.stack[i] : undefined; if (i >= 0) c.stack.splice(i, 1);
      if (open?.test && !c.approvals.length && (input.status === 'ok' || input.status === 'error')) go(input.status === 'ok' ? 'tests-pass' : 'tests-fail', true); else show(); break;
    }
    case 'subagent.started': c.stack.push({ id: input.subagent_id, state: 'sub-agent', test: false }); show(); break;
    case 'subagent.done': { const i = c.stack.findIndex((o) => o.id === input.subagent_id); if (i >= 0) c.stack.splice(i, 1); show(); break; }
    case 'approval.requested': if (!c.approvals.includes(input.approval_id)) c.approvals.push(input.approval_id); go('awaiting-approval'); break;
    case 'approval.resolved': {
      const i = c.approvals.indexOf(input.approval_id); if (i < 0) break; c.approvals.splice(i, 1);
      if (!c.approvals.length) { free = true; go(input.decision === 'approve' ? 'approved' : 'denied', true); } // others still open: keep waiting
      break;
    }
    case 'question.asked': go('asking-question'); break;
    case 'compaction.started': go('compacting'); break;
    case 'compaction.ended': if (c.state === 'compacting') go(settle()); break;
    case 'engine.warning': go('warning', true); break;
    case 'error': {
      if (input.code === 'provider_cap_reached' || input.code === 'provider_rate_limited') { effects.push({ type: 'hint', hint: input.code === 'provider_cap_reached' ? 'provider-cap-reached' : 'provider-rate-limited' }); go('warning', true); }
      else if (input.fatal) go('error', true); else go('warning', true); break;
    }
    case 'turn.done': free = true; c = { ...c, turn: false, stack: [], approvals: [] }; go(input.outcome === 'ok' ? 'success' : input.outcome === 'error' ? 'error' : 'idle', true); break;
    case 'exited': free = true; c = { ...c, dead: true, turn: false, stack: [], approvals: [] }; go(input.outcome === 'crash' ? 'crash' : input.outcome === 'error' ? 'error' : 'idle', true); effects.length = 0; break;
    case 'interrupt': free = true; c = { ...c, turn: false, stack: [], approvals: [] }; go('idle', true); break;
    case 'merge_conflict': go('merge-conflict', true); break;
    case 'saving': go('saving', true); break;
    case 'tick': {
      if (input.gen !== c.gen) break;
      if (input.timer === 'dwell') go(settle(), true); else if (input.timer === 'hard') { if (c.state === 'thinking' || c.state === 'planning') go('thinking-hard'); } else if (c.state === 'idle') go('sleeping');
      break;
    }
    default: break; // unknown or irrelevant events (status, usage, limits, model, session): no change, never an error
  }
  return { state: c.state, ctx: c, effects };
}
