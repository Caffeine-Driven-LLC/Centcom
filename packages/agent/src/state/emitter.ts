import { AGENT_WIRE_STATES, type AgentWireState } from '@centcom/protocol';
import type { AgentId } from '../events/index.js';
import type { RunnerClock } from '../runner/types.js';
import type { MachineState } from './mapping.js';

const WIRE: ReadonlySet<string> = new Set(AGENT_WIRE_STATES);
export const MIN_GAP_MS = 500; // at most 2 frames per agent per second

export interface WirePayload { agent_id: AgentId; state: AgentWireState; since: string }
export interface StateEmitter { push(agentId: AgentId, s: MachineState): void; /** Drops everything kept for an agent (after it exited); a pending send is still delivered first. */ forget(agentId: AgentId): void; /** Number of agents with kept records. */ size(): number; dispose(): void }
export interface EmitterDeps { clock: RunnerClock; send: (p: WirePayload) => void; /** States that are real but not agent-level (prompt-received, sleeping): for the UI, never sent. */ onLocal?: (agentId: AgentId, s: MachineState) => void }

interface Rec { last?: string; lastSentAt: number; pending?: { state: AgentWireState; since: number }; timer?: unknown; since: number }

/** Sends only the clear payload `{agent_id, state, since}`, never twice in a row with the same state, and at most twice a second per agent (the first change goes out at once, later ones are merged and the latest goes out when the second is due). */
export function createStateEmitter(d: EmitterDeps): StateEmitter {
  const recs = new Map<string, Rec>(); let disposed = false;
  const fire = (id: AgentId, r: Rec) => {
    r.timer = undefined; const p = r.pending; r.pending = undefined; if (!p || disposed) return;
    if (p.state === r.last) return; r.last = p.state; r.lastSentAt = d.clock.now(); d.send({ agent_id: id, state: p.state, since: new Date(p.since).toISOString() });
  };
  return {
    push(id, s) {
      if (disposed) return; const r = recs.get(id) ?? { lastSentAt: -Infinity, since: 0 }; recs.set(id, r); const now = d.clock.now();
      if (!WIRE.has(s)) { d.onLocal?.(id, s); return; }
      const state = s as AgentWireState; const effective = r.pending?.state ?? r.last; if (state === effective) return; // identical to what is (about to be) the state
      r.pending = { state, since: now };
      if (r.timer !== undefined) return; // a send is already scheduled; it will carry the newest state
      const wait = r.lastSentAt + MIN_GAP_MS - now;
      if (wait <= 0) fire(id, r); else r.timer = d.clock.setTimeout(() => fire(id, r), wait);
    },
    forget(id) {
      const r = recs.get(id); if (!r) return;
      if (r.timer !== undefined) { d.clock.clearTimeout(r.timer as never); r.timer = undefined; fire(id, r); } // deliver the last state (e.g. the crash) instead of losing it
      recs.delete(id);
    },
    size: () => recs.size,
    dispose() { disposed = true; for (const r of recs.values()) if (r.timer !== undefined) d.clock.clearTimeout(r.timer as never); recs.clear(); },
  };
}
