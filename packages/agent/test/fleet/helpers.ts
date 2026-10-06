import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newIdGenerator } from '@centcom/protocol';
import { FakeEngine, VirtualClock, createRng, type FakeEngineOptions } from '@centcom/testkit';
import { afterAll } from 'vitest';
import { createAgentBus, createFleetManager, createRunner, createWorktreeManager, nodeGit, nodeWtFs, type AgentId, type EngineId, type FleetConfig, type FleetNode } from '../../src/index.js';

const dirs: string[] = []; afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
export const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
export function makeRepo(files: Record<string, string> = { 'a.txt': 'a\n', 'src/b.ts': 'b\n' }) {
  const dir = mkdtempSync(join(tmpdir(), 'centcom-fleet-')); dirs.push(dir); sh(dir, 'init', '-q', '-b', 'main'); sh(dir, 'config', 'commit.gpgsign', 'false');
  for (const [k, v] of Object.entries(files)) { mkdirSync(join(dir, k, '..'), { recursive: true }); writeFileSync(join(dir, k), v); } sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'init'); return dir;
}
const tick = () => new Promise<void>((r) => setTimeout(r, 15));
export type Rig = Awaited<ReturnType<typeof fleetRig>>;
export async function fleetRig(o: { limit?: number; config?: Partial<FleetConfig>; engineOpts?: Partial<Record<EngineId, FakeEngineOptions>>; runnerMax?: number } = {}) {
  const repo = makeRepo(); const wtRoot = mkdtempSync(join(tmpdir(), 'centcom-fleet-wt-')); dirs.push(wtRoot);
  const clock = new VirtualClock(); const rng = createRng(11); const ids = newIdGenerator({ now: () => clock.now(), random: (n) => rng.bytes(n) }); const bus = createAgentBus({ onError: (e) => { throw e; } });
  const engines: Record<string, FakeEngine> = { 'claude-code': new FakeEngine({ id: 'claude-code', clock, hasExited: true, ...o.engineOpts?.['claude-code'] }), codex: new FakeEngine({ id: 'codex', clock, hasExited: true, ...o.engineOpts?.codex }) };
  const log = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
  const runner = createRunner({ engines: { get: (id: EngineId) => engines[id] }, bus, ids, clock, log, config: { maxParallel: o.runnerMax ?? 16 }, env: {} });
  const worktrees = createWorktreeManager({ git: nodeGit, fs: nodeWtFs, bus, clock, config: { root: wtRoot } }); let limit = o.limit ?? 4;
  const fleet = createFleetManager({ runner, worktrees, entitlements: { maxParallelAgents: () => limit }, bus, ids, clock, log, config: { stagger_ms: 0, max_minutes: 0, ...o.config }, session: { mode: 'branch', runsOn: 'mem_01JTEST0000000000000000001' } });
  const nodes = new Map<string, FleetNode>(); bus.on('fleet:node', (p) => nodes.set(p.node.id, p.node)); const nodeLog: FleetNode[] = []; bus.on('fleet:node', (p) => nodeLog.push({ ...p.node })); /** The virtual time at which the fleet decided to start each agent (git and the engine take real time, which says nothing about the pacing). */ const decidedAt = new Map<string, number>(); bus.on('fleet:node', (p) => { if (p.node.state === 'starting' && !decidedAt.has(p.node.id)) decidedAt.set(p.node.id, clock.now()); });
  /** Real time for git and the engines, virtual time for the fleet's own timers. */
  const until = async (cond: () => boolean, o2: { stepMs?: number; max?: number } = {}) => { for (let i = 0; i < (o2.max ?? 400); i++) { if (cond()) return; if (o2.stepMs) await clock.advance(o2.stepMs); await tick(); } throw new Error('condition not reached: ' + JSON.stringify([...nodes.values()].map((n) => [n.label, n.state]))); };
  const states = () => [...nodes.values()].filter((n) => n.kind === 'agent').map((n) => n.state); const count = (s: string) => states().filter((x) => x === s).length;
  const spec = (n: number, p: Partial<Parameters<typeof fleet.spawn>[0]> = {}) => ({ repoRoot: repo, engine: 'claude-code' as EngineId, prompt: `task ${n}`, ownerSlug: 'alex', label: `job-${n}`, baseRef: 'main', ...p });
  return { decidedAt, repo, wtRoot, clock, bus, ids, engines, runner, worktrees, fleet, nodes, nodeLog, until, states, count, spec, setLimit: (n: number) => { limit = n; }, finish: async (id: AgentId) => { await runner.get(id)!.stop(); }, tick };
}
