import { assertWritableEventPayload } from '@centcom/protocol';
import type { AgentId } from '../events/index.js';
import type { AgentHandle, ExitOutcome } from '../runner/types.js';
import type { EngineId } from '../types.js';
import type { Worktree } from '../worktrees/manager.js';
import { FleetEnginePaused, FleetError, FleetQueueFull } from './errors.js';
import { id6, labelSlug } from './naming.js';
import { pickNext } from './scheduler.js';
import { DEFAULT_FLEET_CONFIG, type Attention, type BranchReady, type FleetConfig, type FleetDeps, type FleetHandle, type FleetManager, type FleetNode, type FleetResult, type FleetSpawnSpec, type FleetState } from './types.js';

const STOP_ALL_MS = 8000; const LIVE: FleetState[] = ['starting', 'running', 'waiting'];
const PROVIDER = (e: EngineId) => (e === 'claude-code' ? 'anthropic' : e === 'codex' ? 'openai' : 'other') as 'anthropic' | 'openai' | 'other';
interface Entry {
  id: AgentId; spec: FleetSpawnSpec; owner: string; label: string; labelSlug: string; seq: number; state: FleetState; handle?: AgentHandle; worktree?: Worktree; branch?: string; attention?: Attention; error_code?: string; failure?: string;
  stopRequested?: boolean; timer?: unknown; result?: FleetResult; done: Promise<FleetResult>; settle: (r: FleetResult) => void; started?: Promise<void>; exited?: boolean; paused?: boolean;
}
interface Child { id: string; parent: AgentId; label: string; state: FleetState }

export function createFleetManager(d: FleetDeps): FleetManager {
  const cfg: FleetConfig = { ...DEFAULT_FLEET_CONFIG, ...d.config }; const entries = new Map<AgentId, Entry>(); const children = new Map<string, Child>(); const handlers = new Set<(e: BranchReady) => void>();
  const pausedEngines = new Map<EngineId, { code: string; message: string; timer?: unknown }>(); const nextAllowed = new Map<EngineId, number>(); let staggerTimer: unknown; let seq = 0; let counter = 0; let disposed = false;
  const now = () => d.clock.now();
  const limit = () => { const e = Math.floor(Number(d.entitlements.maxParallelAgents())); return Math.max(1, Math.min(Number.isFinite(e) ? e : 1, cfg.max_parallel)); };
  const live = () => [...entries.values()].filter((e) => LIVE.includes(e.state)); const queued = () => [...entries.values()].filter((e) => e.state === 'queued');
  const node = (e: Entry): FleetNode => ({ id: e.id, kind: 'agent', state: e.state, label: e.label, engine: e.spec.engine, ...(e.branch ? { branch: e.branch } : {}), ...(e.attention ? { attention: e.attention } : {}), ...(e.error_code ? { error_code: e.error_code } : {}) });
  const childNode = (c: Child): FleetNode => ({ id: c.id, parent: c.parent, kind: 'subagent', state: c.state, label: c.label });
  const announce = (e: Entry) => d.bus.emit('fleet:node', { node: node(e) });
  const setState = (e: Entry, s: FleetState) => { if (e.state === s) return; e.state = s; announce(e); };

  function pump(): void {
    if (disposed) return; if (staggerTimer !== undefined) { d.clock.clearTimeout(staggerTimer as never); staggerTimer = undefined; }
    for (;;) {
      if (live().length >= limit()) return; const t = now(); const waiting = queued(); if (!waiting.length) return;
      const ready = waiting.filter((e) => !pausedEngines.has(e.spec.engine) && (nextAllowed.get(e.spec.engine) ?? 0) <= t);
      const counts = new Map<string, number>(); for (const e of live()) counts.set(e.owner, (counts.get(e.owner) ?? 0) + 1);
      const pick = pickNext(ready.map((e) => ({ id: e.id, owner: e.owner, seq: e.seq })), counts, limit(), waiting.map((e) => e.owner));
      if (!pick) { // nothing may start right now: wake up when the first engine's stagger ends
        const waits = waiting.filter((e) => !pausedEngines.has(e.spec.engine)).map((e) => (nextAllowed.get(e.spec.engine) ?? 0) - t).filter((w) => w > 0); if (waits.length) staggerTimer = d.clock.setTimeout(() => { staggerTimer = undefined; pump(); }, Math.min(...waits)); return;
      }
      const e = entries.get(pick.id as AgentId)!; nextAllowed.set(e.spec.engine, t + cfg.stagger_ms); setState(e, 'starting'); e.started = begin(e);
    }
  }
  async function begin(e: Entry): Promise<void> {
    try {
      const wt = await d.worktrees.create({ repoRoot: e.spec.repoRoot, agentId: e.id, ownerSlug: e.spec.ownerSlug, baseRef: e.spec.baseRef, label: `${e.labelSlug}-${id6(e.id)}` }); e.worktree = wt; e.branch = wt.branch;
      if (e.stopRequested) { await discard(e); finish(e, { outcome: 'canceled', branchReady: false }, 'canceled'); return; }
      const h = await d.runner.start({ id: e.id, engine: e.spec.engine, cwd: wt.path, prompt: e.spec.prompt, ...(e.spec.model ? { model: e.spec.model } : {}), restart: 'never' }); e.handle = h;
      if (e.exited) return; if (e.stopRequested) { void h.stop(); return; }
      setState(e, h.status() === 'running' ? 'running' : 'waiting'); if (cfg.max_minutes > 0) e.timer = d.clock.setTimeout(() => { e.timer = undefined; e.error_code = 'fleet_timeout'; void stop(e.id); }, cfg.max_minutes * 60_000);
    } catch (err) {
      const code = String((err as { code?: string }).code ?? (err as Error).name ?? 'start_failed');
      if (code === 'runner_busy') { await discard(e); e.worktree = undefined; e.branch = undefined; e.seq = ++seq; setState(e, 'queued'); return; } // the runner has fewer slots than the limit: wait for one
      e.failure = String((err as { tool_message?: string }).tool_message ?? (err as Error).message ?? ''); await discard(e); e.error_code = code; finish(e, { outcome: 'error', error_code: code, branchReady: false }, 'failed'); throw err;
    }
  }
  /** Removes a worktree that nothing happened in. */
  async function discard(e: Entry) { if (!e.worktree) return; try { await d.worktrees.remove(e.worktree); } catch { /* a changed worktree is kept */ } }
  function finish(e: Entry, r: FleetResult, state: FleetState) {
    if (e.result) return; if (e.timer !== undefined) { d.clock.clearTimeout(e.timer as never); e.timer = undefined; } e.result = r; setState(e, state); e.settle(r);
    for (const c of children.values()) if (c.parent === e.id && c.state === 'running') { c.state = state === 'canceled' ? 'canceled' : 'done'; d.bus.emit('fleet:node', { node: childNode(c) }); }
    queueMicrotask(pump);
  }
  async function onExit(e: Entry, outcome: ExitOutcome, reason?: string) {
    e.exited = true; if (e.timer !== undefined) { d.clock.clearTimeout(e.timer as never); e.timer = undefined; }
    const out: FleetResult['outcome'] = outcome === 'ok' ? 'ok' : outcome === 'canceled' ? 'canceled' : 'error'; const code = e.error_code ?? (out === 'error' ? reason ?? outcome : undefined);
    let branchReady = false; let ahead = 0; let files: string[] = [];
    if (e.worktree) {
      try {
        const s = await d.worktrees.status(e.worktree);
        if (!s.dirty && s.ahead === 0) { await d.worktrees.remove(e.worktree); e.attention = undefined; } else if (!s.dirty) { e.attention = 'branch ready'; branchReady = true; ahead = s.ahead; files = await d.worktrees.changedFiles(e.worktree).catch(() => []); } else e.attention = 'needs attention';
      } catch { e.attention = 'needs attention'; }
    }
    finish(e, { outcome: out, ...(code ? { error_code: code } : {}), branchReady }, out === 'ok' ? 'done' : out === 'canceled' ? 'canceled' : 'failed');
    if (branchReady && e.branch) { const ev: BranchReady = { agentId: e.id, branch: e.branch, ahead, files }; d.bus.emit('fleet:branch_ready', ev); for (const h of [...handlers]) { try { h(ev); } catch { /* a handler's problem is its own */ } } }
  }

  const offEvent = d.bus.on('agent:event', (p) => {
    const e = entries.get(p.agent_id); if (!e) return; const ev = p.event;
    if (ev.type === 'turn.started' && e.state === 'waiting') setState(e, 'running'); else if (ev.type === 'turn.done' && e.state === 'running') setState(e, 'waiting');
    else if (ev.type === 'subagent.started') { const c: Child = { id: ev.subagent_id, parent: e.id, label: ev.label, state: 'running' }; children.set(c.id, c); d.bus.emit('fleet:node', { node: childNode(c) }); }
    else if (ev.type === 'subagent.done') { const c = children.get(ev.subagent_id); if (c) { c.state = ev.status === 'ok' ? 'done' : ev.status === 'canceled' ? 'canceled' : 'failed'; d.bus.emit('fleet:node', { node: childNode(c) }); } }
    else if (ev.type === 'error' && (ev.code === 'provider_cap_reached' || ev.code === 'provider_rate_limited')) pause(e.spec.engine, ev.code, ev.tool_message, ev.retry?.delay_ms);
  });
  const offExit = d.bus.on('agent:exited', (p) => { const e = entries.get(p.agent_id); if (e) void onExit(e, p.outcome, p.reason); });
  function pause(engine: EngineId, code: string, message: string, retryMs?: number) {
    const old = pausedEngines.get(engine); if (old?.timer !== undefined) d.clock.clearTimeout(old.timer as never); // running agents are not touched; only new spawns wait
    pausedEngines.set(engine, { code, message, ...(retryMs ? { timer: d.clock.setTimeout(() => resume(engine), retryMs) } : {}) });
  }
  function resume(engine: EngineId) { const p = pausedEngines.get(engine); if (p?.timer !== undefined) d.clock.clearTimeout(p.timer as never); pausedEngines.delete(engine); pump(); }

  async function spawn(spec: FleetSpawnSpec): Promise<FleetHandle> {
    if (disposed) throw new FleetError('invalid_spec', 'The fleet has been shut down.'); if (!spec || typeof spec.repoRoot !== 'string' || !spec.repoRoot || typeof spec.prompt !== 'string' || !spec.ownerSlug) throw new FleetError('invalid_spec', 'A fleet agent needs a folder, an owner and a prompt.');
    const paused = pausedEngines.get(spec.engine); if (paused) throw new FleetEnginePaused(spec.engine, paused.message); if (queued().length >= cfg.queue_max) throw new FleetQueueFull(cfg.queue_max);
    const id = d.ids.next('agt'); const n = ++counter; const label = (spec.label ?? '').trim() || `agent-${n}`; let settle!: (r: FleetResult) => void; const done = new Promise<FleetResult>((res) => { settle = res; });
    const e: Entry = { id, spec, owner: spec.ownerSlug, label, labelSlug: labelSlug(label, n), seq: ++seq, state: 'queued', done, settle }; entries.set(id, e); announce(e); pump();
    if (e.started) await e.started; // an agent that can start now reports a start failure here
    return handle(e);
  }
  const handle = (e: Entry): FleetHandle => ({ id: e.id, get branch() { return e.branch; }, state: () => e.state, done: () => e.done, describe: () => ({ label: e.label, engine: e.spec.engine, ...(e.branch ? { branch: e.branch } : {}), ...(e.worktree ? { worktree: e.worktree.path } : {}), ...(e.spec.model ? { model: e.spec.model } : {}), ...(e.spec.ownerId ? { ownerId: e.spec.ownerId } : {}) }) });
  const find = (id: AgentId): Entry => { const e = entries.get(id); if (!e) throw new FleetError('not_found', 'There is no such agent.'); return e; };

  async function stop(id: AgentId): Promise<void> {
    const e = entries.get(id); if (!e || e.result) return; e.stopRequested = true;
    if (e.state === 'queued') { finish(e, { outcome: 'canceled', branchReady: false }, 'canceled'); return; }
    if (e.state === 'starting') { await e.started?.catch(() => undefined); if (e.result) return; }
    const h = e.handle; if (!h) return; void h.interrupt().catch(() => undefined);
    // the runner ends an engine that ignores the interrupt (terminate at 5 s, kill at 7 s); this only makes sure nothing here waits longer than that
    await within(STOP_ALL_MS, h.stop().catch(() => undefined)); await within(2000, e.done);
  }
  async function within<T>(ms: number, p: Promise<T>): Promise<T | undefined> { let timer: unknown; const late = new Promise<undefined>((res) => { timer = d.clock.setTimeout(() => res(undefined), ms); }); try { return await Promise.race([p, late]); } finally { d.clock.clearTimeout(timer as never); } }
  async function stopAll(): Promise<void> {
    for (const e of queued()) await stop(e.id); const running = [...entries.values()].filter((e) => !e.result); await within(STOP_ALL_MS, Promise.all(running.map((e) => stop(e.id))));
    for (const e of running) if (!e.result) finish(e, { outcome: 'canceled', error_code: 'stop_timeout', branchReady: false }, 'canceled'); // whatever is left is shown as ended
  }
  async function remove(id: AgentId, o: { force?: boolean } = {}) {
    const e = find(id); if (!e.result) throw new FleetError('still_running', 'Stop the agent first.'); if (e.worktree) { await d.worktrees.remove(e.worktree, o); e.worktree = undefined; } entries.delete(id); for (const [cid, c] of children) if (c.parent === id) children.delete(cid);
  }
  async function mergePreview(id: AgentId) { const e = find(id); if (!e.worktree) throw new FleetError('not_found', 'This agent has no worktree.'); return { conflicts: await d.worktrees.detectConflict(e.worktree, e.worktree.baseRef) }; }
  async function recoverOrphans(repoRoot: string): Promise<Worktree[]> { const known = new Set([...entries.values()].filter((e) => !e.result).map((e) => e.id)); return (await d.worktrees.list(repoRoot)).filter((w) => !known.has(w.agentId)); }

  return {
    spawn, stop, stopAll, remove, mergePreview, recoverOrphans, resume, list: () => [...entries.values()].flatMap((e) => [node(e), ...[...children.values()].filter((c) => c.parent === e.id).map(childNode)]),
    onBranchReady: (h) => { handlers.add(h); return () => { handlers.delete(h); }; }, paused: () => [...pausedEngines].map(([engine, p]) => ({ engine, code: p.code, message: p.message })),
    spawnPayload(h) {
      const i = h.describe(); if (!i.ownerId) throw new FleetError('no_owner', 'The member who owns this agent is not known.'); const clear = { agent_id: h.id as string, owner: i.ownerId, mode: d.session?.mode ?? 'branch', ...(d.session?.runsOn ? { runs_on: d.session.runsOn } : {}), provider: PROVIDER(i.engine) };
      assertWritableEventPayload('agent.spawn', clear); return { clear, secret: { label: i.label, branch: i.branch ?? '', worktree: i.worktree ?? '', ...(i.model ? { model: i.model } : {}) } };
    },
    exitPayload(h, r) { const clear = { agent_id: h.id as string, outcome: r.outcome, ...(r.error_code ? { error_code: r.error_code } : {}) }; assertWritableEventPayload('agent.exit', clear); const e = entries.get(h.id); return { clear, secret: { ...(e?.failure ? { detail: e.failure } : {}) } }; },
    dispose() { disposed = true; offEvent(); offExit(); if (staggerTimer !== undefined) d.clock.clearTimeout(staggerTimer as never); for (const e of entries.values()) if (e.timer !== undefined) d.clock.clearTimeout(e.timer as never); for (const p of pausedEngines.values()) if (p.timer !== undefined) d.clock.clearTimeout(p.timer as never); },
  };
}
