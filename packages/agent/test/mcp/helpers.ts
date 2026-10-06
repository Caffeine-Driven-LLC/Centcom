import { VirtualClock } from '@centcom/testkit';
import { createAgentBus, createMcpManager, type EngineReport, type McpFs, type McpServerDef, type McpDeps } from '../../src/index.js';

export const files = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); const writes: string[] = []; const fs: McpFs = { read: async (p) => m.get(p), writeAtomic: async (p, t) => { writes.push(p); m.set(p, t); } }; return { m, writes, fs }; };
export function rig(o: { files?: Record<string, string>; which?: (c: string) => string | undefined; status?: McpDeps['engines']['status']; testSession?: McpDeps['engines']['testSession'] } = {}) {
  const f = files(o.files); const clock = new VirtualClock(); const bus = createAgentBus({ onError: (e) => { throw e; } }); const sessions: { engine: string; json: string }[] = []; const events: unknown[] = []; bus.on('mcp:status', (p) => events.push(p));
  const testSession = o.testSession ?? (async (_engine: string, json: string): Promise<EngineReport> => { const name = Object.keys(JSON.parse(json).mcpServers)[0]!; return { servers: [{ name, status: 'connected', tools: 3 }] }; });
  const mgr = createMcpManager({ fs: f.fs, home: '/home/u', clock, bus, which: o.which ?? ((c) => `/usr/bin/${c}`), engines: { status: o.status, testSession: async (e, j, x) => { sessions.push({ engine: e, json: j }); return testSession(e, j, x); } } });
  return { mgr, f, clock, bus, sessions, events, root: '/proj' };
}
export const FILES: McpServerDef = { name: 'files', transport: 'stdio', command: 'npx', args: ['-y', 'some-mcp'] };
export const ok = (plan: { planHash: string }) => ({ accepted: true as const, planHash: plan.planHash });
