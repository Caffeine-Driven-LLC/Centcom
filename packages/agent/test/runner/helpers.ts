import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newIdGenerator } from '@centcom/protocol';
import { FakeEngine, VirtualClock, createRng, type FakeEngineOptions } from '@centcom/testkit';
import { createAgentBus, createRunner, type AgentEventMap, type AgentRunner, type AgentSpec, type EngineId, type RunnerConfig, type RunnerDeps } from '../../src/index.js';

export interface Rig { runner: AgentRunner; clock: VirtualClock; engine: FakeEngine; bus: ReturnType<typeof createAgentBus>; log: { level: string; msg: string; ctx?: Record<string, unknown> }[]; busLog: { name: string; p: any }[]; busErrors: unknown[]; dirs: () => Promise<string>; spec: (o?: Partial<AgentSpec>) => Promise<AgentSpec> }

export function rig(o: { engine?: FakeEngineOptions; config?: Partial<RunnerConfig>; deps?: Partial<RunnerDeps>; engines?: Record<string, FakeEngine> } = {}): Rig {
  const clock = new VirtualClock(); const rng = createRng(5); const ids = newIdGenerator({ now: () => clock.now(), random: (n) => rng.bytes(n) });
  const engine = new FakeEngine({ clock, hasExited: true, ...o.engine }); const busErrors: unknown[] = []; const bus = createAgentBus({ onError: (e) => busErrors.push(e) });
  const log: Rig['log'] = []; const l = (level: string) => (msg: string, ctx?: Record<string, unknown>) => { log.push({ level, msg, ctx }); };
  const busLog: Rig['busLog'] = []; for (const name of ['agent:started', 'agent:event', 'agent:exited', 'agent:approval_needed', 'agent:approval_resolved'] as (keyof AgentEventMap)[]) bus.on(name, (p) => busLog.push({ name, p }));
  const engines = o.engines ?? { fake: engine };
  const runner = createRunner({ engines: { get: (id: EngineId) => engines[id], preflight: o.deps?.engines?.preflight }, bus, ids, clock, log: { debug: l('debug'), info: l('info'), warn: l('warn'), error: l('error') }, config: o.config, env: {}, ...o.deps } as RunnerDeps);
  let n = 0;
  const dirs = async () => mkdtemp(join(tmpdir(), `centcom-runner-${++n}-`));
  return { runner, clock, engine, bus, log, busLog, busErrors, dirs, spec: async (s = {}) => ({ engine: 'fake', cwd: await dirs(), prompt: 'hello', ...s }) };
}
export const flush = () => new Promise<void>((r) => setImmediate(r));
/** Let pending work run, move virtual time, let the consequences run. Draining first matters: a handler that is about to arm a timer must do so before time moves. */
export const settle = async (r: Rig, ms = 0) => { await flush(); await flush(); await r.clock.advance(ms); await flush(); await flush(); };
