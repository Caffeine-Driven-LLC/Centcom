/** The app's own agents (the rows of the local session) as fleet rows, so the rail and the web board draw the same list from the same table. */
import type { AgentView } from '../state/model.js';
import type { FleetAgent } from './model.js';

export const SELF_MEMBER = 'self';
/** `since(id, state)` says when the agent entered that state (an ISO time); the app remembers it. Your own agents are slot 0; teammates' agents take the next slots in list order. */
export function fleetFromAgents(agents: readonly AgentView[], o: { since(id: string, state: string): string }): FleetAgent[] {
  let slot = 0;
  return agents.map((a) => ({
    agentId: a.id, label: a.name, ownerMemberId: a.mine ? SELF_MEMBER : a.id, ownerName: a.mine ? 'you' : a.name, ownerSlot: a.mine ? 0 : ++slot, branch: a.branch || undefined,
    state: a.state, since: o.since(a.id, a.state), mode: 'branch' as const, needsMe: a.mine && (a.state === 'awaiting-approval' || a.state === 'asking-question'),
  }));
}
/** Remembers when each agent entered its current state. */
export function createSinceTracker(now: () => number = Date.now): (id: string, state: string) => string {
  const seen = new Map<string, { state: string; at: number }>();
  return (id, state) => { const e = seen.get(id); if (e && e.state === state) return new Date(e.at).toISOString(); const at = now(); seen.set(id, { state, at }); return new Date(at).toISOString(); };
}
