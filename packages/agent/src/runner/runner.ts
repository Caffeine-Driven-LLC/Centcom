import { realpath, stat } from 'node:fs/promises';
import type { EngineSession, NormalisedEvent, PermissionGate, ApprovalRequest, ApprovalDecision, EngineId } from '../types.js';
import { ProviderError } from '../types.js';
import { resolve as resolvePath } from 'node:path';
import { childEnv } from './env.js';
import { RunnerBusy, RunnerError } from './errors.js';
import { Subscriber } from './subscribers.js';
import type { AgentId } from '../events/index.js';
import { DEFAULT_RUNNER_CONFIG, MAX_PARALLEL_HARD_CAP, type AgentEvent, type AgentHandle, type AgentInfo, type AgentRunner, type AgentSpec, type AgentStatus, type ExitOutcome, type RunnerConfig, type RunnerDeps } from './types.js';

const LIVE: ReadonlySet<AgentStatus> = new Set(['starting', 'running', 'waiting', 'stopping']);
const KEEP_EXITED = 50;

export function createRunner(deps: RunnerDeps): AgentRunner {
  const cfg: RunnerConfig = { ...DEFAULT_RUNNER_CONFIG, ...deps.config }; cfg.maxParallel = Math.max(1, Math.min(MAX_PARALLEL_HARD_CAP, cfg.maxParallel));
  const { bus, clock, log } = deps; const agents = new Map<string, Agent>(); const starting = new Set<Agent>();
  const liveAgents = () => [...agents.values()].filter((a) => LIVE.has(a.state));

  class Agent implements AgentHandle {
    readonly id: AgentId; readonly engine: EngineId;
    state: AgentStatus = 'starting'; outcome?: ExitOutcome; since: string;
    session?: EngineSession; private seq = 0; private ring: AgentEvent[] = []; private subs = new Set<Subscriber>();
    private queue: string[] = []; private turnActive = false; turns = 0; private stopping = false; private finished = false; private restarts = 0;
    private lastEventAt = 0; private watchdog?: unknown; private escalation: unknown[] = []; private pumpDone: Promise<void> = Promise.resolve(); private exitedSeen = false;
    private pending = new Map<string, (d: ApprovalDecision) => void>(); private forced?: { outcome: ExitOutcome; reason?: string };
    cwdKey = ''; private halting?: Promise<void>; private open = new Set<string>(); // approval ids the engine is waiting on, whichever gate answers them

    constructor(readonly spec: AgentSpec) { this.id = spec.id ?? deps.ids.next('agt'); this.engine = spec.engine; this.since = new Date(clock.now()).toISOString(); }
    status() { return this.state; }
    info(): AgentInfo { return { id: this.id, engine: this.engine, status: this.state, since: this.since, ...(this.spec.parentAgentId ? { parent: this.spec.parentAgentId } : {}), turns: this.turns, queued: this.queue.length, ...(this.outcome ? { outcome: this.outcome } : {}) }; }

    /* ---------------- public handle ---------------- */
    async send(prompt: string): Promise<void> {
      if (this.finished || this.stopping) throw new RunnerError('agent_gone', 'This agent has ended.');
      if (this.state === 'starting') throw new RunnerError('agent_gone', 'This agent is still starting.');
      if (this.turnActive) { if (this.queue.length >= cfg.promptQueueMax) throw new RunnerError('queue_full', `Already ${cfg.promptQueueMax} messages are waiting.`); this.queue.push(prompt); return; }
      await this.dispatch(prompt);
    }
    async interrupt(): Promise<void> {
      if (this.finished || !this.turnActive || !this.session) return;
      log.debug('agent.interrupt', { agent_id: this.id });
      const s = this.session; void Promise.resolve().then(() => s.interrupt()).catch((e) => log.warn('agent.interrupt_failed', { agent_id: this.id, err: errName(e) }));
      this.armEscalation(() => this.turnActive, () => this.finish('canceled', 'interrupt_ignored'));
    }
    stop(): Promise<void> {
      if (this.finished) return Promise.resolve();
      return (this.halting ??= this.halt('ok'));
    }
    events(o: { replay?: boolean } = {}): AsyncIterable<AgentEvent> {
      const sub = new Subscriber(cfg.ringSize, () => this.subs.delete(sub)); this.subs.add(sub);
      if (o.replay) for (const e of this.ring) sub.push(e);
      if (this.finished) sub.end();
      return { [Symbol.asyncIterator]: () => sub.iterator() };
    }

    /* ---------------- start / restart ---------------- */
    async begin(resume?: string): Promise<void> {
      const engine = deps.engines.get(this.engine); if (!engine) throw new RunnerError('engine_unknown', `No engine named ${this.engine}.`);
      const o = { agentId: this.id, cwd: this.spec.cwd, ...(this.spec.permissionMode ? { permissionMode: this.spec.permissionMode } : {}), ...(this.spec.model ? { model: this.spec.model } : {}), ...(resume ? { resume: { engine_session_id: resume } } : {}),
        ...(this.spec.systemPromptAppend ? { systemPromptAppend: this.spec.systemPromptAppend } : {}), ...(this.spec.addDirs ? { addDirs: this.spec.addDirs } : {}), ...(this.spec.allowedTools ? { allowedTools: this.spec.allowedTools } : {}),
        env: childEnv(deps.env ?? process.env, this.id, deps.platform), envExact: true, approvalGate: this.gate, limits: { interrupt_grace_ms: cfg.interruptGraceMs } };
      let timer: unknown; const timeout = new Promise<never>((_r, rej) => { timer = clock.setTimeout(() => rej(new RunnerError('engine_start_timeout', 'The engine did not start in time.')), cfg.startTimeoutMs); });
      let session: EngineSession; try { session = await Promise.race([engine.start(o), timeout]); } finally { clock.clearTimeout(timer as never); }
      this.session = session;
    }
    /** Starts reading the engine's events. Separate from `begin` so `agent:started` is published first. */
    attach(): void {
      const session = this.session; if (!session) return; this.pumpDone = this.pump(session);
      if (session.exited) void session.exited.then((x) => { if (this.session === session && !this.stopping && !this.finished) this.onCrash(x.code, x.signal); });
    }

    /* ---------------- events ---------------- */
    private async pump(session: EngineSession): Promise<void> {
      try {
        for await (const raw of session.events) { if (this.session !== session) return; this.onEvent(raw); }
        if (this.session === session && !this.stopping && !this.finished) this.onCrash(undefined, undefined); // the stream ended on its own
      } catch (e) { if (this.session === session && !this.stopping && !this.finished) { log.warn('agent.stream_failed', { agent_id: this.id, err: errName(e) }); this.onCrash(undefined, undefined); } }
    }
    private onEvent(raw: NormalisedEvent) {
      this.lastEventAt = clock.now(); const seq = ++this.seq; const ev = { ...raw, agent_id: this.id, seq } as NormalisedEvent; const rec: AgentEvent = { agent_id: this.id, seq, event: ev };
      this.ring.push(rec); if (this.ring.length > cfg.ringSize) this.ring.shift();
      for (const s of this.subs) s.push(rec);
      bus.emit('agent:event', { agent_id: this.id, seq, event: ev });
      if (ev.type === 'session.started' && this.state === 'starting') this.state = this.turnActive ? 'running' : 'waiting';
      if (ev.type === 'turn.started') { this.turnActive = true; if (this.state === 'waiting') this.state = 'running'; }
      if (ev.type === 'approval.resolved') this.open.delete(ev.approval_id);
      if (ev.type === 'approval.requested') this.open.add(ev.approval_id);
      if (ev.type === 'approval.requested') bus.emit('agent:approval_needed', { agent_id: this.id, approval_id: ev.approval_id as never, risk: ev.risk, expires_at: new Date(clock.now() + cfg.approvalTimeoutMs).toISOString() });
      if (ev.type === 'error' && ev.fatal) this.lastFatal = ev.code;
      if (ev.type === 'turn.done') this.onTurnDone(ev.outcome, ev);
    }
    private onTurnDone(outcome: 'ok' | 'error' | 'canceled', ev: NormalisedEvent) {
      this.turnActive = false; this.turns++; this.clearEscalation(); this.disarmWatchdog(); this.denyAllPending('interrupt');
      if (this.stopping || this.finished) return;
      this.state = 'waiting';
      const fatal = this.lastFatal; this.lastFatal = undefined;
      if (outcome === 'error' && fatal === 'provider_protocol_error' && ev.type === 'turn.done' && ev.stop_reason === 'line_too_long') { void this.finish('error', 'provider_protocol_error'); return; }
      if (this.spec.oneShot) { void this.finish(outcome === 'ok' ? 'ok' : outcome === 'canceled' ? 'canceled' : 'error'); return; }
      this.drainQueue();
    }
    /** Sends the oldest queued prompt, if any. Later ones follow from each turn.done, so order is kept and a new send() queues behind them. */
    private drainQueue() { if (this.turnActive || this.finished || this.stopping || !this.session) return; const next = this.queue.shift(); if (next !== undefined) void this.dispatch(next).catch((e) => log.warn('agent.queue_send_failed', { agent_id: this.id, err: errName(e) })); }
    private lastFatal?: string;

    async dispatch(prompt: string): Promise<void> {
      const s = this.session; if (!s) throw new RunnerError('agent_gone', 'No session.');
      this.turnActive = true; this.state = 'running'; this.armWatchdog();
      try { await s.send(prompt); } catch (e) { this.turnActive = false; this.disarmWatchdog(); if (!this.stopping) this.state = 'waiting'; throw e; }
    }

    /* ---------------- watchdog and escalation ---------------- */
    private armWatchdog() {
      this.disarmWatchdog(); this.lastEventAt = clock.now();
      const check = () => {
        const idle = clock.now() - this.lastEventAt; if (!this.turnActive || this.finished) return;
        if (idle < cfg.turnWatchdogMs) { this.watchdog = clock.setTimeout(check, cfg.turnWatchdogMs - idle); return; }
        log.warn('agent.watchdog', { agent_id: this.id }); this.forced = { outcome: 'error', reason: 'watchdog_timeout' }; this.halting ??= this.halt('error');
      };
      this.watchdog = clock.setTimeout(check, cfg.turnWatchdogMs);
    }
    private disarmWatchdog() { if (this.watchdog !== undefined) clock.clearTimeout(this.watchdog as never); this.watchdog = undefined; }
    private armEscalation(stillBusy: () => boolean, giveUp: () => void) {
      this.clearEscalation(); const s = this.session;
      this.escalation.push(clock.setTimeout(() => {
        if (!stillBusy()) return; log.warn('agent.sigterm', { agent_id: this.id }); s?.signal?.('SIGTERM');
        this.escalation.push(clock.setTimeout(() => { if (!stillBusy()) return; log.warn('agent.sigkill', { agent_id: this.id }); s?.signal?.('SIGKILL'); giveUp(); }, cfg.termGraceMs));
      }, cfg.interruptGraceMs));
    }
    private clearEscalation() { for (const t of this.escalation.splice(0)) clock.clearTimeout(t as never); }

    /* ---------------- ending ---------------- */
    private async halt(outcome: ExitOutcome): Promise<void> {
      this.stopping = true; this.state = 'stopping'; this.denyAllPending('cancel'); this.disarmWatchdog(); this.queue = [];
      const s = this.session; if (!s) return this.finish(outcome);
      let ended = false; void this.pumpDone.then(() => { ended = true; });
      if (this.turnActive) { void Promise.resolve().then(() => s.interrupt()).catch(() => undefined); outcome = outcome === 'ok' ? 'canceled' : outcome; }
      void Promise.resolve().then(() => s.stop()).catch((e) => log.warn('agent.stop_failed', { agent_id: this.id, err: errName(e) }));
      await new Promise<void>((res) => {
        void this.pumpDone.then(res); this.clearEscalation();
        this.escalation.push(clock.setTimeout(() => { if (ended) return; s.signal?.('SIGTERM'); this.escalation.push(clock.setTimeout(() => { s.signal?.('SIGKILL'); outcome = 'canceled'; res(); }, cfg.termGraceMs)); }, cfg.interruptGraceMs));
      });
      await this.finish(this.forced?.outcome ?? outcome, this.forced?.reason);
    }
    private onCrash(code?: number, signal?: string) {
      if (this.finished || this.stopping) return; log.warn('agent.crash', { agent_id: this.id, engine: this.engine, code, signal, restarts: this.restarts });
      const old = this.session; const token = old?.resumeToken(); this.turnActive = false; this.disarmWatchdog(); this.clearEscalation(); this.denyAllPending('cancel'); this.session = undefined;
      void Promise.resolve().then(() => old?.stop()).catch(() => undefined);
      const delay = cfg.restartDelaysMs[this.restarts];
      if (this.spec.restart === 'on-crash' && delay !== undefined) {
        this.restarts++; this.state = 'starting';
        clock.setTimeout(() => { if (this.finished || this.stopping) return; this.begin(token).then(() => { this.attach(); this.state = 'waiting'; this.drainQueue(); }).catch((e) => { log.warn('agent.restart_failed', { agent_id: this.id, err: errName(e) }); this.onCrash(); }); }, delay);
        return;
      }
      void this.finish('crash', undefined, code, signal);
    }
    /** Grace ran out: SIGKILL the engine and end the agent as canceled without waiting for it to say goodbye. */
    async kill(): Promise<void> { const s = this.session; try { s?.signal?.('SIGKILL'); } catch { /* already gone */ } this.stopping = true; await this.finish('canceled', 'stop_grace_expired'); }
    /** The start failed before anyone was told about this agent: release what it holds, say nothing. */
    abort() { if (this.finished) return; this.finished = true; this.stopping = true; this.clearEscalation(); this.disarmWatchdog(); const s = this.session; this.session = undefined; void Promise.resolve().then(() => s?.stop()).catch(() => undefined); this.state = 'exited'; }
    async finish(outcome: ExitOutcome, reason?: string, code?: number, signal?: string): Promise<void> {
      if (this.finished) return; this.finished = true; this.stopping = true; this.clearEscalation(); this.disarmWatchdog(); this.denyAllPending('cancel');
      this.outcome = outcome; this.state = outcome === 'crash' ? 'crashed' : 'exited';
      const s = this.session; this.session = undefined; if (s && outcome !== 'ok') void Promise.resolve().then(() => s.stop()).catch(() => undefined);
      for (const sub of this.subs) sub.end();
      bus.emit('agent:exited', { agent_id: this.id, outcome, ...(code !== undefined ? { code } : {}), ...(signal ? { signal } : {}), ...(reason ? { reason } : {}) });
      log.info('agent.exited', { agent_id: this.id, engine: this.engine, outcome, turns: this.turns, ...(reason ? { reason } : {}) });
      this.trimExited();
    }
    private trimExited() { const gone = [...agents.values()].filter((a) => !LIVE.has(a.state)); for (const a of gone.slice(0, Math.max(0, gone.length - KEEP_EXITED))) agents.delete(a.id); }

    /* ---------------- approvals ---------------- */
    readonly gate: PermissionGate = {
      decide: (req: ApprovalRequest) => deps.permissions ? this.viaBroker(deps.permissions, req) : new Promise<ApprovalDecision>((resolve) => {
        const timer = clock.setTimeout(() => this.settle(req.approval_id, { decision: 'deny', scope: 'once', reason: 'timeout' }, 'timeout'), cfg.approvalTimeoutMs);
        this.pending.set(req.approval_id, (d) => { clock.clearTimeout(timer as never); resolve(d); });
      }),
    };
    private viaBroker(b: PermissionGate, req: ApprovalRequest): Promise<ApprovalDecision> {
      this.open.add(req.approval_id); return Promise.resolve(b.decide(req)).finally(() => this.open.delete(req.approval_id));
    }
    settle(id: string, d: ApprovalDecision, label: 'allow' | 'deny' | 'timeout' | 'cancel') { const r = this.pending.get(id); if (!r) return false; this.pending.delete(id); r(d); bus.emit('agent:approval_resolved', { agent_id: this.id, approval_id: id as never, decision: label }); return true; }
    resolve(id: string, d: { decision: 'approve' | 'deny'; scope?: 'once' | 'session' | 'always' }) { return this.settle(id, { decision: d.decision, scope: d.scope ?? 'once' }, d.decision === 'approve' ? 'allow' : 'deny'); }
    private denyAllPending(why: 'cancel' | 'interrupt') {
      for (const id of [...this.open]) { try { deps.permissions?.cancel?.(id); } catch (e) { log.warn('agent.cancel_failed', { agent_id: this.id, err: errName(e) }); } } this.open.clear();
      for (const id of [...this.pending.keys()]) this.settle(id, { decision: 'deny', scope: 'once', reason: why }, 'cancel'); }
    }

  /** The folder as the one-agent-per-folder rule sees it: symlinks resolved, trailing slashes gone, case folded where the filesystem ignores case. A folder that cannot be resolved falls back to its normalised path (start() then rejects it as cwd_invalid). */
  const cwdKey = async (cwd: string) => {
    let p = await realpath(cwd).catch(() => resolvePath(cwd)); p = p.length > 1 ? p.replace(/[\\/]+$/, '') || p : p;
    return (deps.platform ?? process.platform) === 'darwin' || (deps.platform ?? process.platform) === 'win32' ? p.toLowerCase() : p;
  };
  const errName = (e: unknown) => (e instanceof Error ? e.name : typeof e);

  const runner: AgentRunner = {
    async start(spec) {
      if (deps.providerEnabled && !deps.providerEnabled(spec.engine)) throw new ProviderError('provider_method_disabled', spec.engine, 'This way of using the provider is turned off.');
      if (!deps.engines.get(spec.engine)) throw new RunnerError('engine_unknown', `No engine named ${spec.engine}.`);
      if (spec.id !== undefined && (!/^agt_[0-9A-HJKMNP-TV-Z]{26}$/.test(spec.id) || agents.has(spec.id))) throw new RunnerError('cwd_invalid', 'That agent id is not usable.');
      const key = await cwdKey(spec.cwd); // resolved before the checks below, which must run with no await until the agent is counted
      if (liveAgents().length + starting.size >= cfg.maxParallel) throw new RunnerBusy(cfg.maxParallel);
      if (!spec.allowSharedCwd && [...liveAgents(), ...starting].some((a) => a.cwdKey === key)) throw new RunnerError('cwd_in_use', 'Another agent is already working in that folder.');
      const agent = new Agent(spec); agent.cwdKey = key; starting.add(agent); // counted from now on, so two racing starts cannot both take the last slot
      try {
        const st = await stat(spec.cwd).catch(() => undefined); if (!st?.isDirectory()) throw new RunnerError('cwd_invalid', 'The folder does not exist.');
        await deps.engines.preflight?.(spec.engine);
        await agent.begin(spec.resume);
        agents.set(agent.id, agent); agent.state = 'waiting'; starting.delete(agent);
        bus.emit('agent:started', { agent_id: agent.id, engine: spec.engine, ...(spec.model ? { model: spec.model } : {}), cwd: spec.cwd, at: agent.since }); agent.attach();
        log.info('agent.started', { agent_id: agent.id, engine: spec.engine });
        if (spec.prompt) { try { await agent.dispatch(spec.prompt); } catch (e) { await agent.finish('error', 'start_failed'); agents.delete(agent.id); throw e; } }
        return agent;
      } catch (e) { starting.delete(agent); agents.delete(agent.id); agent.abort(); throw e; }
    },
    get: (id) => agents.get(id),
    list: () => [...agents.values()].map((a) => a.info()),
    resolveApproval: (agentId, approvalId, d) => agents.get(agentId)?.resolve(approvalId, d) ?? false,
    async stopAll(o = {}) {
      const live = liveAgents(); const all = Promise.all(live.map((a) => a.stop())); if (o.graceMs === undefined) return all.then(() => undefined);
      let timer: unknown; const late = new Promise<'late'>((res) => { timer = clock.setTimeout(() => res('late'), o.graceMs!); });
      if ((await Promise.race([all.then(() => 'done' as const), late])) === 'late') { await Promise.all(live.map((a) => a.kill())); } clock.clearTimeout(timer as never);
    },
  };
  return runner;
}
