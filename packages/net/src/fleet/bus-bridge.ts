/** Turns the local agent bus into session events: rate-limited and coalesced by FleetSync, local-only text never forwarded. */
import type { FleetSync } from './sync.js';
/** The small part of the agent runtime's bus this needs (`@centcom/agent`'s EventBus fits). */
export interface BusLike { on(k: string, h: (p: never) => unknown): () => void }
export interface BridgeOptions { mode: 'command_post' | 'branch'; /** `true` shares the branch and worktree of each new agent (they are encrypted on the wire) */ shareDetails?: boolean; warn?: (msg: string, ctx?: Record<string, unknown>) => void }
type Started = { agent_id: string; model?: string; cwd: string }; type State = { agent_id: string; state: string }; type Exited = { agent_id: string; outcome: 'ok' | 'error' | 'canceled' | 'crash'; reason?: string }; type Tree = { agent_id: string; path: string; branch: string };
export function bridgeBus(bus: BusLike, fleet: FleetSync, o: BridgeOptions): () => void {
  const trees = new Map<string, Tree>(); const offs: (() => void)[] = [];
  const guard = (p: Promise<unknown> | void): void => { if (p) p.catch((e: unknown) => o.warn?.('fleet.bridge_failed', { code: (e as { code?: string }).code })); };
  offs.push(bus.on('worktree:created', ((t: Tree) => { trees.set(t.agent_id, t); }) as never));
  offs.push(bus.on('agent:started', ((a: Started) => { const t = trees.get(a.agent_id); guard(fleet.spawn({ agentId: a.agent_id, mode: o.mode, ...(a.model ? { model: a.model } : {}), ...(o.shareDetails && t ? { branch: t.branch, worktree: t.path } : {}) })); }) as never));
  offs.push(bus.on('agent:state_changed', ((s: State) => { try { fleet.setState(s.agent_id, s.state); } catch (e) { o.warn?.('fleet.state_not_shared', { code: (e as { code?: string }).code }); } }) as never));
  offs.push(bus.on('agent:exited', ((x: Exited) => { guard(fleet.exit(x.agent_id, x.outcome === 'crash' ? 'error' : x.outcome, x.outcome === 'crash' ? 'crash' : x.reason)); trees.delete(x.agent_id); }) as never));
  return () => { for (const f of offs.splice(0)) f(); };
}
