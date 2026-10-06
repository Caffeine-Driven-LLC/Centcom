/** The engine processes Centcom started, by agent. Signals only ever go to these pids (or their process groups), never to anything found by name. */
import { spawnSync } from 'node:child_process';

export type Sig = 'SIGINT' | 'SIGTERM' | 'SIGKILL';
export interface Killed { pid: number; signal: Sig }
export interface ProcessRegistry {
  /** `group`: the process leads its own process group (spawned detached), so a signal reaches its children too. Returns the unregister function. */
  register(agentId: string, pid: number, o?: { group?: boolean }): () => void;
  pids(agentId: string): number[];
  /** Signals every registered process of the agent (their whole groups) and returns what was sent. */
  signal(agentId: string, sig: Sig): Killed[];
  /** Last-resort cleanup on exit: SIGKILL to every registered group. */
  killAll(): void;
}
export interface ProcDeps { kill?: (pid: number, sig: Sig) => void; platform?: NodeJS.Platform; taskkill?: (pid: number) => void }

export function createProcessRegistry(d: ProcDeps = {}): ProcessRegistry {
  const byAgent = new Map<string, Map<number, { group: boolean }>>(); const platform = d.platform ?? process.platform;
  const kill = d.kill ?? ((pid, sig) => process.kill(pid, sig));
  const taskkill = d.taskkill ?? ((pid) => { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); });
  const send = (pid: number, group: boolean, sig: Sig): boolean => {
    if (platform === 'win32') { try { if (sig === 'SIGKILL') taskkill(pid); else kill(pid, sig); return true; } catch { return false; } } // Windows has no groups; taskkill /T takes the tree
    if (group) { try { kill(-pid, sig); return true; } catch { /* the group is gone; try the process itself */ } }
    try { kill(pid, sig); return true; } catch { return false; }
  };
  return {
    register(agentId, pid, o = {}) { let m = byAgent.get(agentId); if (!m) { m = new Map(); byAgent.set(agentId, m); } m.set(pid, { group: !!o.group }); return () => { byAgent.get(agentId)?.delete(pid); }; },
    pids: (agentId) => [...(byAgent.get(agentId)?.keys() ?? [])],
    signal(agentId, sig) { const out: Killed[] = []; for (const [pid, p] of byAgent.get(agentId) ?? []) if (send(pid, p.group, sig)) out.push({ pid, signal: sig }); return out; },
    killAll() { for (const m of byAgent.values()) for (const [pid, p] of m) send(pid, p.group, 'SIGKILL'); },
  };
}

/** One registry for the whole app, cleaned up when Node exits so no engine outlives Centcom. */
let shared: ProcessRegistry | undefined;
export function sharedProcessRegistry(): ProcessRegistry {
  if (!shared) { shared = createProcessRegistry(); const r = shared; process.once('exit', () => r.killAll()); }
  return shared;
}
