import type { AgentBus } from '../events/index.js';
import type { CheckpointManager } from './types.js';

/** A checkpoint at the start of every turn (before the first tool runs) and an end marker when the turn is over. `label` gives the text of the prompt for that turn. */
export function attachCheckpoints(bus: AgentBus, agentId: string, mgr: CheckpointManager, o: { label(turnSeq: number): string; engineSession?(): { id: string; turnRef?: string } | undefined }): () => void {
  let turn = 0;
  return bus.on('agent:event', (p) => {
    if (p.agent_id !== agentId) return; const e = p.event;
    if (e.type === 'turn.started') { const seq = ++turn; void mgr.create(o.label(seq), { promptSeq: seq, engineSession: o.engineSession?.() }).catch(() => undefined); }
    else if (e.type === 'turn.done') void mgr.endTurn().catch(() => undefined);
  });
}
