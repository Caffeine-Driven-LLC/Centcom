import type { AgentId, AgentBus } from '../events/index.js';
import type { RunnerClock } from '../runner/types.js';
import { initialCtx, nextState, type HintSource, type LocalHint, type RunnerSignal, type StateCtx } from './machine.js';
import type { StateEmitter } from './emitter.js';
import type { MachineState } from './mapping.js';

export interface AttachOptions { clock: RunnerClock; hints?: HintSource; plan?: (agentId: AgentId) => boolean; onState?: (agentId: AgentId, s: MachineState) => void; onHint?: (agentId: AgentId, h: LocalHint) => void }
export interface Disposable { dispose(): void }
export interface StateMachineHandle extends Disposable { /** Number of agents with a live machine. */ size(): number }

/** Subscribes to `agent:event` and `agent:exited`, runs one machine per agent, and pushes every state change to the emitter. Timers use the injected clock. */
export function attachStateMachine(bus: AgentBus, emitter: StateEmitter, o: AttachOptions): StateMachineHandle {
  const agents = new Map<string, { ctx: StateCtx; timers: unknown[] }>(); let disposed = false;
  const gone = new Set<string>(); // the most recent exited agents only (bounded), so a late event does not revive a dead machine
  const apply = (id: AgentId, input: Parameters<typeof nextState>[1]) => {
    if (disposed || gone.has(id)) return; let a = agents.get(id); if (!a) { a = { ctx: initialCtx({ plan: o.plan?.(id), now: o.clock.now() }), timers: [] }; agents.set(id, a); }
    const before = a.ctx; const step = nextState(a.ctx, input, o.clock.now(), o.hints); a.ctx = step.ctx;
    if (step.ctx.gen !== before.gen) { for (const t of a.timers.splice(0)) o.clock.clearTimeout(t as never); }
    for (const e of step.effects) {
      if (e.type === 'timer') a.timers.push(o.clock.setTimeout(() => apply(id, { type: 'tick', timer: e.timer, gen: e.gen } satisfies RunnerSignal), e.ms));
      else o.onHint?.(id, e.hint);
    }
    if (step.ctx.state !== before.state) { emitter.push(id, step.ctx.state); o.onState?.(id, step.ctx.state); }
    if (step.ctx.dead) { for (const t of a.timers.splice(0)) o.clock.clearTimeout(t as never); agents.delete(id); emitter.forget(id); gone.add(id); if (gone.size > 64) gone.delete(gone.values().next().value as string); } // exited: nothing more will come for this agent
  };
  const offs = [bus.on('agent:event', (p) => apply(p.agent_id, p.event)), bus.on('agent:exited', (p) => apply(p.agent_id, { type: 'exited', outcome: p.outcome }))];
  return { size: () => agents.size, dispose() { disposed = true; offs.forEach((f) => f()); for (const a of agents.values()) for (const t of a.timers) o.clock.clearTimeout(t as never); agents.clear(); } };
}
