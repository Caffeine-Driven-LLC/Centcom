/** The pieces every front end (terminal, print mode, web) gives the controller: the permission policy with saved rules, checkpoints and context settings. */
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ClaudeCodeEngine, CodexEngine, FileTrustStore, createLedger, createLockClient, nodeLockFs, toolKind, type NormalisedEvent, createAgentBus, createFleetManager, createPermissionEngine, createPermissionGate, createRiskClassifier, createRuleStore, createRunner, createWorktreeManager, nodeGit, nodePermFs, nodeWtFs, type AgentEngine, type EngineId, type PermissionEngine, type PermissionMode, type PolicyMode } from '@centcom/agent';
import { newIdGenerator } from '@centcom/protocol';
import { userInfo } from 'node:os';
import { defaultDeps, userConfigPath } from '@centcom/config';
import type { ControllerOptions } from './controller.js';
import type { AppController } from './controller.js';

export interface RuntimeOptions {
  cwd: string; engineId: string; demo: boolean;
  /** Started with --dangerously-skip-permissions: the `bypass` mode may be used (hard denies still apply). */ dangerous?: boolean;
  /** No one can answer an approval (print mode): anything that would ask is denied. */ headless?: boolean;
  /** Where permissions.json and trust.json live; defaults to the user config folder. */ configDir?: string; home?: string;
  checkpoints?: boolean;
  /** `budget.session_usd` (0 = no budget). */ sessionUsd?: number; /** Where the usage outbox lives (default ~/.centcom). */ stateDir?: string;
  /** Run parallel agents in their own worktrees (`/fleet`). On unless turned off. */ fleet?: boolean;
  /** At most this many fleet agents at once (the plan's limit once accounts exist). */ maxParallel?: number;
}
export interface Runtime { options: Pick<ControllerOptions, 'policy' | 'checkpoints' | 'fleet' | 'observers' | 'ledger' | 'ledgerBus'>; /** Connect the controller once it exists: approvals are shown by it. */ bind(ctl: AppController): void; warnings: string[] }

export async function buildRuntime(o: RuntimeOptions): Promise<Runtime> {
  if (o.demo) return { options: {}, bind: () => undefined, warnings: [] }; // the demo engine keeps its simple built-in rules
  const home = o.home ?? homedir(); const dir = o.configDir ?? dirname(userConfigPath(defaultDeps({ homedir: home }))); let ctl: AppController | undefined;
  const clock = { now: () => Date.now(), setTimeout: (f: () => void, ms: number) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, clearTimeout: (h: never) => clearTimeout(h as NodeJS.Timeout) };
  const rules = createRuleStore({ fs: nodePermFs, clock, trust: new FileTrustStore(join(dir, 'trust.json')), userRulesPath: join(dir, 'permissions.json') });
  const rc = createRiskClassifier({ root: o.cwd, cwd: o.cwd, home, platform: process.platform === 'win32' ? 'win32' : 'posix' });
  const engine: PermissionEngine = createPermissionEngine({ fs: nodePermFs, clock, rules, classifier: { classify: (r) => rc.classify(r).risk },
    prompter: { prompt: (p, signal) => (ctl ? ctl.promptApproval(p, signal) : Promise.resolve({ decision: 'deny', scope: 'once', reason: 'no_ui' })) },
    config: { home, userRulesPath: join(dir, 'permissions.json'), bypassEnabled: !!o.dangerous, headless: !!o.headless, os: process.platform === 'win32' ? 'win32' : 'posix' } });
  const warnings: string[] = [];
  await rules.loadUser().catch(() => warnings.push('Your saved permission rules could not be read, so none are used.'));
  const proj = await rules.loadProject(o.cwd).catch(() => ({ loaded: false, needsTrust: false })); if (proj.needsTrust) warnings.push('This project has its own permission rules file. It is not used until you type /trust rules.');
  warnings.push(...rules.warnings());
  let fleet: ControllerOptions['fleet']; const observers: NonNullable<ControllerOptions['observers']> = [];
  if (o.fleet !== false) {
    const bus = createAgentBus({ onError: () => undefined }); const ids = newIdGenerator({ now: () => Date.now(), random: (n) => new Uint8Array(randomBytes(n)) });
    const engines: Partial<Record<EngineId, AgentEngine>> = { 'claude-code': new ClaudeCodeEngine(), codex: new CodexEngine() }; const roots = new Map<string, string>();
    bus.on('worktree:created', (w) => roots.set(w.agent_id, w.path));
    const quiet = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
    // every fleet agent goes through the same policy as the main one, limited to its own worktree
    const gate = createPermissionGate(engine, (agentId) => ({ agentId, root: roots.get(agentId) ?? o.cwd, mode: policyMode(ctl?.state.settings.permissionMode ?? 'default'), engine: 'claude-code' }));
    const runner = createRunner({ engines: { get: (id) => engines[id] }, bus, ids, clock, log: quiet, config: { maxParallel: 16 }, permissions: gate, env: process.env });
    const worktrees = createWorktreeManager({ git: nodeGit, fs: nodeWtFs, bus, clock, log: quiet });
    const manager = createFleetManager({ runner, worktrees, entitlements: { maxParallelAgents: () => o.maxParallel ?? 8 }, bus, ids, clock, log: quiet });
    // advisory file locks: two agents changing the same file (each in its own worktree) are told, because their branches will conflict
    const locks = createLockClient({ root: o.cwd, fs: nodeLockFs, clock, bus, config: { mode: 'warn', defaultTtlMs: 120_000 } });
    const touch = (agentId: string, ev: NormalisedEvent, root: string) => {
      if (ev.type === 'turn.done' && agentId === 'agt_you') { void locks.releaseAll(agentId as never).catch(() => undefined); return; }
      if (ev.type !== 'tool.requested' || !ev.path || !['edit', 'create', 'delete'].includes(toolKind(ev.name))) return;
      const rel = isAbsolute(ev.path) ? relative(root, ev.path) : ev.path; if (!rel || rel.startsWith('..')) return;
      void locks.acquire(rel, { agentId: agentId as never }).then((r) => { if (r.ok && r.heldBy && r.heldBy !== agentId) ctl?.toast('warn', `${ctl.agentName(agentId)} is changing ${rel}, which ${ctl.agentName(r.heldBy)} is also changing: their branches will conflict there.`, 6000); }, () => undefined);
    };
    bus.on('agent:event', ({ agent_id, event }) => touch(agent_id, event, roots.get(agent_id) ?? o.cwd)); observers.push((id, ev) => touch(id, ev, o.cwd));
    fleet = { manager, bus, ownerSlug: (() => { try { return userInfo().username || 'me'; } catch { return 'me'; } })() };
  }
  // usage as the engines reported it; the outbox only fills a local file (sending it is the usage-client lane)
  const ledgerBus = createAgentBus({ onError: () => undefined }); const ids = newIdGenerator({ now: () => Date.now(), random: (n) => new Uint8Array(randomBytes(n)) });
  const ledger = createLedger({ clock, ids: { next: () => ids.next('use') }, bus: ledgerBus, fs: o.demo ? memoryFs() : { read: async (p) => { try { return (await import('node:fs/promises')).readFile(p, 'utf8'); } catch { return undefined; } }, writeAtomic: async (p, t) => { const fsp = await import('node:fs/promises'); await fsp.mkdir(dirname(p), { recursive: true }); const tmp = `${p}.${randomBytes(4).toString('hex')}.tmp`; await fsp.writeFile(tmp, t, { mode: 0o600 }); await fsp.rename(tmp, p); } }, outboxPath: join(o.stateDir ?? join(home, '.centcom'), 'usage', 'outbox.jsonl'), config: { sessionUsd: o.sessionUsd || undefined } });
  await ledger.ready().catch(() => undefined);
  return { options: { ledger, ledgerBus, policy: { engine, root: o.cwd }, ...(o.checkpoints === false ? {} : { checkpoints: {} }), ...(fleet ? { fleet, observers } : {}) }, bind: (c) => { ctl = c; }, warnings };
}
const MODE_MAP: Record<PermissionMode, PolicyMode> = { default: 'ask', acceptEdits: 'accept-edits', plan: 'plan', bypassPermissions: 'bypass' };
/** The demo keeps its usage in memory. */
const memoryFs = () => { const m = new Map<string, string>(); return { read: async (p: string) => m.get(p), writeAtomic: async (p: string, t: string) => { m.set(p, t); } }; };
export const policyMode = (m: PermissionMode): PolicyMode => MODE_MAP[m] ?? 'ask';
