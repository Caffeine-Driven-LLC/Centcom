import type { AgentId } from '../events/index.js';
import type { LockClient } from './types.js';

/** For the permission engine: in `block` mode an edit to a file another agent holds is denied with the reason `file_locked`. In `warn` mode it never denies. */
export function lockGate(client: LockClient, mode: 'warn' | 'block'): (agentId: AgentId, path: string) => { deny: true; reason: 'file_locked'; heldBy: AgentId } | undefined {
  return (agentId, path) => { if (mode !== 'block') return undefined; const i = client.check(path); return i && i.heldBy !== agentId ? { deny: true, reason: 'file_locked', heldBy: i.heldBy } : undefined; };
}
