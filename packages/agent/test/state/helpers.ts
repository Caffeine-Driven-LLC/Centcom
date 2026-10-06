import { VirtualClock } from '@centcom/testkit';
import { AGENT_WIRE_STATES } from '@centcom/protocol';
import { createAgentBus, attachStateMachine, createStateEmitter, type AgentId, type MachineState, type NormalisedEvent, type WirePayload } from '../../src/index.js';
import type { EventBody } from '../../src/types.js';

export const AGT = 'agt_01JTEST0000000000000000001' as AgentId;
export const WIRE: ReadonlySet<string> = new Set(AGENT_WIRE_STATES);
export const ev = (b: EventBody, seq = 1): NormalisedEvent => ({ ...b, v: 1, seq, ts: '2026-10-06T00:00:00.000Z', agent_id: AGT } as NormalisedEvent);

export function harness(o: { plan?: boolean; hints?: Parameters<typeof attachStateMachine>[2]['hints'] } = {}) {
  const clock = new VirtualClock(); const bus = createAgentBus({ onError: (e) => { throw e; } }); const sends: WirePayload[] = []; const machine: MachineState[] = []; const local: MachineState[] = []; const hints: string[] = [];
  const emitter = createStateEmitter({ clock, send: (p) => sends.push(p), onLocal: (_a, s) => local.push(s) });
  const att = attachStateMachine(bus, emitter, { clock, plan: () => !!o.plan, hints: o.hints, onState: (_a, s) => machine.push(s), onHint: (_a, h) => hints.push(h) }); let seq = 0;
  const push = (b: EventBody) => bus.emit('agent:event', { agent_id: AGT, seq: ++seq, event: ev(b, seq) });
  const settle = async (ms = 0) => { await clock.advance(ms); };
  return { clock, bus, sends, machine, local, hints, push, settle, att, emitter, exit: (outcome: 'ok' | 'error' | 'canceled' | 'crash') => bus.emit('agent:exited', { agent_id: AGT, outcome }) };
}
