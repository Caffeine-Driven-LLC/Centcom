/** The rows of the fleet list, kept up to date from session events, and their order. */
import { priorityTier } from './labels.js';

export interface FleetAgent { agentId: string; label?: string; ownerMemberId: string; ownerName: string; ownerSlot: number; branch?: string; state: string; since: string; mode: 'command_post' | 'branch'; needsMe: boolean; exit?: { outcome: 'ok' | 'error' | 'canceled'; errorCode?: string } }
export interface FleetState { agents: Record<string, FleetAgent> }
export type FleetEvent =
  | { k: 'agent.spawn'; agentId: string; label?: string; ownerMemberId: string; ownerName: string; ownerSlot: number; mode?: FleetAgent['mode']; branch?: string; since?: string }
  | { k: 'agent.state'; agentId: string; state: string; since: string; needsMe?: boolean }
  | { k: 'agent.exit'; agentId: string; outcome: 'ok' | 'error' | 'canceled'; errorCode?: string; since?: string }
  | { k: 'branch.update'; agentId: string; branch: string };
export const emptyFleet = (): FleetState => ({ agents: {} });
export function reduceFleet(s: FleetState, e: FleetEvent): FleetState {
  const a = s.agents;
  switch (e.k) {
    case 'agent.spawn': return { agents: { ...a, [e.agentId]: { agentId: e.agentId, label: e.label, ownerMemberId: e.ownerMemberId, ownerName: e.ownerName, ownerSlot: e.ownerSlot, branch: e.branch, state: 'idle', since: e.since ?? new Date(0).toISOString(), mode: e.mode ?? 'branch', needsMe: false } } };
    case 'agent.state': { const x = a[e.agentId]; if (!x || x.exit) return s; if (x.state === e.state && x.needsMe === (e.needsMe ?? false)) return s; return { agents: { ...a, [e.agentId]: { ...x, state: e.state, since: e.since, needsMe: e.needsMe ?? false } } }; }
    case 'agent.exit': { const x = a[e.agentId]; if (!x) return s; return { agents: { ...a, [e.agentId]: { ...x, state: e.outcome === 'error' ? 'error' : 'idle', since: e.since ?? x.since, needsMe: false, exit: { outcome: e.outcome, errorCode: e.errorCode } } } }; }
    case 'branch.update': { const x = a[e.agentId]; if (!x || x.branch === e.branch) return s; return { agents: { ...a, [e.agentId]: { ...x, branch: e.branch } } }; }
    default: return s;
  }
}
/** Most urgent tier first; within it, rows that need you; then the one waiting longest. */
export function sortFleet(agents: FleetAgent[]): FleetAgent[] {
  return [...agents].sort((x, y) => priorityTier(x.state) - priorityTier(y.state) || Number(y.needsMe) - Number(x.needsMe) || Date.parse(x.since) - Date.parse(y.since) || x.agentId.localeCompare(y.agentId));
}
