/**
 * AppController: owns the engine session, turns normalised engine events into transcript items and agent states,
 * answers approvals through the permission policy, runs slash commands, and drives the mascot.
 * The React tree only reads the store and calls the controller's methods.
 */
import { CLAUDE_MODELS, createAgentBus, createCheckpointManager, createContextView, modelLabel, newId, nodeGit } from '@centcom/agent';
import type { AgentBus, AgentId, FleetManager, FleetNode, Checkpoint, CheckpointManager, ContextConfig, ContextView, EngineId, EngineStartOptions, GitRunner, PermissionEngine, PolicyMode, RewindMode } from '@centcom/agent';
import type { PendingApproval as PolicyPending } from '@centcom/agent';
import type { Logger } from '@centcom/net';
import { SessionStore, ago, titleFrom, type SessionMeta } from './sessions.js';
import { MASTER_DIR, discover, injection, masterSkills, match, setEnabled, type Skill } from '@centcom/skills';
import { MascotDriver, bakedByCategory, bakedCategories, getBaked, type CentoColor } from '@centcom/mascot';
import type { AgentEngine, ApprovalDecision, ApprovalRequest, EngineSession, NormalisedEvent, PermissionGate, PermissionMode } from '@centcom/agent';
import { Store } from './state/store.js';
import { initialSettings, isBusyState, stateToMini, type AgentView, type AppState, type Item, type PendingApproval, type Settings } from './state/model.js';
import { COMMANDS } from './state/commands.js';
import { emptyText } from './onboarding/copy.js';
import { reduceTasks } from './tasks/model.js';
import { VerbRotator } from './util/verbs.js';

export interface ControllerOptions {
  engine: AgentEngine; demo: boolean; cwd: string; branch?: string; version: string; permissionMode?: PermissionMode;
  onExit?: () => void; ghosts?: boolean; settings?: Partial<Settings>; verbs?: VerbRotator;
  skills?: Skill[]; // pass [] to disable discovery (tests)
  /** Where to save conversations; leave out to keep them in memory only. */
  sessions?: SessionStore;
  /** Prompt history to start with, and a hook to save it when it changes. */
  history?: string[]; onHistory?: (h: string[]) => void;
  /** Called when a remembered setting or panel changes (the config layer decides what to write). */
  onPrefs?: (p: { settings: Settings; fleet: boolean }) => void;
  /** Text for /config: what is set and where each value came from. */
  describeConfig?: () => string;
  /** Where to record what happened. Only ids and enums are logged, never message text, paths or commands. */
  logger?: Logger;
  /** Called with every engine event, before the UI state changes (used by print mode and stream-json). */
  onEvent?: (ev: NormalisedEvent) => void;
  /** Continue a saved conversation: 'last' for the newest one in this folder, or a session id. */
  resume?: string;
  /** Started with --dangerously-skip-permissions: Shift+Tab can cycle into bypass. */
  dangerous?: boolean;
  /** A line that starts with `# ` is a note for the memory files, not a prompt. Returns the diff to confirm, and what to do when the person says yes. */
  onMemoryAdd?: (text: string) => Promise<{ diff: string; apply: () => Promise<string> } | { error: string }>;
  /** The permission policy engine (hard denies, saved rules, modes). Without it the controller uses its own simple built-in rules (demo and tests). Its prompter must call `promptApproval`. */
  policy?: { engine: PermissionEngine; root: string };
  /** Save a checkpoint of the folder before every prompt so `/rewind` can go back. Off when left out. */
  checkpoints?: { git?: GitRunner };
  /** Context warnings and automatic compaction (engine-reported numbers only). */
  context?: Partial<ContextConfig>;
  /** Parallel agents in their own worktrees (`/fleet`). Their events, branch-ready news and approvals come over `bus`. */
  fleet?: { manager: FleetManager; bus: AgentBus; ownerSlug: string };
  /** Read-only views for `/mcp`, `/hooks` and `/memory` (the CLI's own list and status output). */
  views?: Partial<Record<'mcp' | 'hooks' | 'memory', (args: string[]) => Promise<string[]>>>;
  /** Called with the main agent's events too (file locks between agents use it). */
  observers?: ((agentId: string, ev: NormalisedEvent) => void)[];
}
const FLEET_COLORS: CentoColor[] = ['green', 'yellow', 'red', 'brown', 'violet'];
const FLEET_STATE: Record<string, string> = { queued: 'queued', starting: 'prompt-received', running: 'thinking', waiting: 'idle', done: 'success', failed: 'error', canceled: 'idle' };
const POLICY_MODE: Record<PermissionMode, PolicyMode> = { default: 'ask', acceptEdits: 'accept-edits', plan: 'plan', bypassPermissions: 'bypass' };
const HARD_DENY: Record<string, string> = { credential_path: 'it touches a credentials file', outside_root: 'it writes outside this project', git_internals: 'it writes inside .git', agent_stopped: 'the agent was stopped' };

let uid = 0;
const nid = (p: string) => `${p}${++uid}`;

const DEMO_PROMPTS: Record<string, string> = {
  fix: 'fix the failing test in the auth module', search: 'find where isExpired is used', delete: 'delete node_modules and force push a clean build',
  compact: 'compact the context', ask: 'ask me which way to fix it', error: 'simulate a login error', limit: 'simulate a usage limit',
};
const MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan'];

export class AppController {
  readonly store: Store<AppState>;
  readonly driver: MascotDriver;
  private session?: EngineSession;
  private verbs: VerbRotator;
  private sessionRules = new Set<string>();
  private ghostTimers: NodeJS.Timeout[] = [];
  private toastTimers = new Map<string, NodeJS.Timeout>();
  private verbTimer?: NodeJS.Timeout;
  private lastExitPress = 0;
  private readonly me = 'agt_you';
  private bus: AgentBus = createAgentBus({ onError: () => undefined });
  private ctxView?: ContextView; private cp?: CheckpointManager; private pendingReqs = new Map<string, ApprovalRequest>(); private lastEsc = 0;

  constructor(private o: ControllerOptions) {
    this.verbs = o.verbs ?? new VerbRotator();
    const settings = { ...initialSettings(), permissionMode: o.permissionMode ?? 'default', ...o.settings };
    const me: AgentView = { id: this.me, name: 'you', color: settings.color, mine: true, engine: o.engine.label, provider: o.engine.provider, model: '', loginKind: 'unknown', state: 'idle', mini: 'idle', busy: false, branch: o.branch ?? '', runsOn: 'you', cost: 0, inTok: 0, outTok: 0 };
    this.store = new Store<AppState>({
      items: [], agents: [me], activeAgent: this.me, mode: 'chat', input: '', cursor: 0, history: o.history ?? [], histIdx: null, draft: '', scroll: 0, toasts: [], approvals: [], settings,
      busy: false, verb: this.verbs.next(), limits: [], cwd: o.cwd, branch: o.branch ?? '', engineId: o.engine.id, engineLabel: o.engine.label, demo: o.demo, fleet: true, tasks: [], tasksOpen: true,
      slashSel: 0, palette: { query: '', sel: 0 }, modelSel: 0, gallery: { cat: 0, idx: 0, color: 0, query: '' }, version: o.version, sessionId: newId('ses'), sessions: [],
    });
    this.driver = new MascotDriver({ reducedMotion: settings.reducedMotion, color: settings.color });
    const clock = { now: () => Date.now(), setTimeout: (f: () => void, ms: number) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, clearTimeout: (h: never) => clearTimeout(h as NodeJS.Timeout) };
    this.ctxView = createContextView({ bus: this.bus, clock, config: o.context, engines: { capabilities: () => o.engine.capabilities(), status: () => (this.state.busy ? 'running' : this.session ? 'waiting' : 'starting'), send: async (_id, prompt) => { await this.session?.send(prompt); } } });
    this.bus.on('agent:context_alert', (a) => { if (a.level === 'warn') this.notice('warn', `The context is ${Math.round(a.pct)}% full.`, 'Type /compact to have the agent compact it.'); else if (a.level === 'full') { this.notice('warn', 'The context is almost full.', 'Type /compact now, or start fresh with /new.'); this.driver.setState('context-full'); } });
    if (o.fleet) this.watchFleet(o.fleet);
    if (o.checkpoints) this.cp = createCheckpointManager({ worktree: o.cwd, agentId: this.me, git: o.checkpoints.git ?? nodeGit, clock,
      store: { markRewind: async (seq) => this.rewindTranscript(seq), summarize: async (seq, max) => this.summaryUpTo(seq, max) },
      engine: { capabilities: () => o.engine.capabilities(), start: (so) => o.engine.start({ ...this.startOptions(so.resume?.engine_session_id), ...so }) } });
  }

  get state() { return this.store.get(); }
  /** The display name of an agent ("you" for the main one). */
  agentName(id: string) { return this.state.agents.find((a) => a.id === id)?.name ?? 'an agent'; }
  private set(p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) { this.store.set(p); }
  /** UI-level state changes (input buffer, scroll, mode, overlay selections). */
  patch(p: Partial<AppState>) { this.store.set(p); }
  private updateAgent(id: string, fn: (a: AgentView) => Partial<AgentView>) { this.set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, ...fn(a) } : a)) })); }
  private addItem(it: Item) { this.set((s) => ({ items: [...s.items, it] })); }
  private patchItem(pred: (i: Item) => boolean, fn: (i: Item) => Item) { this.set((s) => ({ items: s.items.map((i) => (pred(i) ? fn(i) : i)) })); }

  /* ------------------------------------------------------------------ lifecycle */
  async start() {
    this.driver.start();
    this.driver.setState('ready');
    let resumeToken: string | undefined;
    if (this.o.resume && this.o.sessions) {
      const id = this.o.resume === 'last' ? this.o.sessions.list(this.o.cwd, 1)[0]?.id : this.o.resume;
      const saved = id ? this.o.sessions.load(id) : undefined;
      if (saved) { resumeToken = saved.meta.resumeToken; this.loadSaved(saved.meta, saved.items); }
      else this.notice('warn', this.o.resume === 'last' ? 'No saved conversation in this folder yet, so this is a new one.' : 'Could not find that saved conversation, so this is a new one.');
    }
    await this.startEngine(resumeToken);
    if (this.o.ghosts) this.startGhosts();
    this.verbTimer = setInterval(() => { if (this.state.busy) this.set({ verb: this.verbs.next() }); }, 4200);
    this.verbTimer.unref?.();
    this.refreshSessions();
    // save shortly after anything changes, never on every streamed token
    this.store.subscribe(() => this.schedulePersist());
    let lastSettings = this.state.settings; let lastFleet = this.state.fleet;
    this.store.subscribe(() => { const s = this.state; if (s.settings !== lastSettings || s.fleet !== lastFleet) { lastSettings = s.settings; lastFleet = s.fleet; this.o.onPrefs?.({ settings: s.settings, fleet: s.fleet }); } });
  }

  private startOptions(resumeToken?: string): EngineStartOptions {
    const gate: PermissionGate = { decide: (r) => this.decide(r) };
    return { agentId: this.me, cwd: this.o.cwd, permissionMode: this.state.settings.permissionMode, model: this.state.settings.model || undefined, addDirs: this.o.demo ? undefined : [MASTER_DIR], approvalGate: gate, ...(resumeToken ? { resume: { engine_session_id: resumeToken } } : {}) };
  }
  private async startEngine(resumeToken?: string) { this.adopt(await this.o.engine.start(this.startOptions(resumeToken))); }
  /** Make `s` the running engine session (after a start, or a conversation rewind). */
  private adopt(s: EngineSession) { this.session = s; void this.consume(s); }

  /* ------------------------------------------------------------------ saved conversations */
  private persistTimer?: NodeJS.Timeout; private lastItems?: Item[]; private lastToken?: string; private lastSid = '';
  private schedulePersist() {
    if (!this.o.sessions || this.persistTimer) return;
    this.persistTimer = setTimeout(() => { this.persistTimer = undefined; this.persist(); }, 600); this.persistTimer.unref?.();
  }
  persist() {
    const st = this.o.sessions; const s = this.state; if (!st || !s.items.length) return;
    const first = s.items.find((i) => i.kind === 'user');
    const meta: SessionMeta = { id: s.sessionId, cwd: this.o.cwd, engine: this.o.engine.id, title: titleFrom(s.items), model: s.settings.model || undefined, resumeToken: this.session?.resumeToken(), createdAt: this.createdAt ?? (first && first.kind === 'user' ? first.ts : Date.now()), updatedAt: Date.now(), messages: s.items.filter((i) => i.kind === 'user').length, ...(s.tasks.length ? { tasks: s.tasks } : {}), tasksOpen: s.tasksOpen };
    this.createdAt = meta.createdAt;
    // items are replaced (never mutated) on every change, so identity tells us whether anything new needs saving
    if (s.items === this.lastItems && meta.resumeToken === this.lastToken && s.sessionId === this.lastSid && s.tasks === this.lastTasks && s.tasksOpen === this.lastTasksOpen) return;
    this.lastItems = s.items; this.lastTasks = s.tasks; this.lastTasksOpen = s.tasksOpen; this.lastToken = meta.resumeToken; this.lastSid = s.sessionId;
    try { st.save(meta, s.items); this.refreshSessions(); } catch (e) { this.toast('warn', 'Could not save this conversation: ' + String((e as Error).message ?? e)); }
  }
  private createdAt?: number; private lastTasks?: unknown; private lastTasksOpen?: boolean;
  private refreshSessions() { if (this.o.sessions) this.set({ sessions: this.o.sessions.list(this.o.cwd, 10) }); }
  private loadSaved(meta: SessionMeta, items: Item[]) {
    this.createdAt = meta.createdAt;
    this.set({ sessionId: meta.id, items, scroll: 0, tasks: meta.tasks ?? [], tasksOpen: meta.tasksOpen ?? true, ...(meta.model !== undefined ? { settings: { ...this.state.settings, model: meta.model ?? '' } } : {}) });
    this.addItem({ kind: 'notice', id: nid('n'), level: 'ok', text: `Continuing "${meta.title}"`, detail: `${meta.messages} message${meta.messages === 1 ? '' : 's'} · last used ${ago(meta.updatedAt)}` });
  }
  /** Start over with an empty context. The old conversation stays saved and can be resumed. */
  async newSession() {
    if (this.state.busy) { this.toast('warn', 'Cento is still working. Press Esc to interrupt, then try again.'); return; }
    this.persist(); await this.session?.stop();
    this.createdAt = undefined; this.lastItems = undefined;
    this.set({ items: [], scroll: 0, sessionId: newId('ses'), approvals: [], tasks: [] });
    await this.startEngine();
  }
  /** Switch to a saved conversation from this folder. `which` is a list number (1 = newest) or an id. */
  async resumeSession(which: string) {
    if (!this.o.sessions) { this.toast('info', 'Saving conversations is turned off.'); return; }
    if (this.state.busy) { this.toast('warn', 'Cento is still working. Press Esc to interrupt, then try again.'); return; }
    const list = this.o.sessions.list(this.o.cwd, 10);
    const id = /^\d+$/.test(which) ? list[Number(which) - 1]?.id : which;
    const saved = id ? this.o.sessions.load(id) : undefined;
    if (!saved) { this.toast('warn', `No saved conversation "${which}". Type /resume to see the list.`); return; }
    this.persist(); await this.session?.stop();
    this.lastItems = undefined; this.set({ items: [], approvals: [] }); this.loadSaved(saved.meta, saved.items);
    await this.startEngine(saved.meta.resumeToken);
  }
  private listSessions() {
    const list = this.o.sessions?.list(this.o.cwd, 10) ?? [];
    if (!list.length) { this.addItem({ kind: 'notice', id: nid('n'), level: 'info', text: emptyText('no-sessions') }); return; }
    this.addItem({ kind: 'notice', id: nid('n'), level: 'info', text: 'Saved conversations in this folder. Type /resume 1 (or another number) to continue one.', detail: list.map((m, i) => `${i + 1}${m.id === this.state.sessionId ? '*' : ' '} ${m.title}  ·  ${m.messages} msg  ·  ${ago(m.updatedAt)}`).join('\n') });
  }

  stop() {
    this.persist();
    this.driver.stop(); this.ghostTimers.forEach(clearTimeout); if (this.verbTimer) clearInterval(this.verbTimer);
    this.toastTimers.forEach(clearTimeout);
    for (const a of this.state.approvals) a.resolve({ decision: 'deny', scope: 'once', reason: 'exit' });
    void this.session?.stop();
    void this.stopFleet();
  }
  /** Fleet agents are this app's own processes: stop them before exiting (at most about 8 s). */
  stopFleet(): Promise<void> { return this.o.fleet ? this.o.fleet.manager.stopAll().catch(() => undefined) : Promise.resolve(); }

  private async consume(s: EngineSession) { for await (const ev of s.events) { if (s !== this.session) break; this.apply(ev); } } // a replaced session's leftovers are not shown

  /* ------------------------------------------------------------------ events -> state */
  apply(ev: NormalisedEvent) {
    this.o.onEvent?.(ev);
    this.logEvent(ev);
    try { this.ctxView?.onEvent(ev); } catch { /* the meter never breaks the transcript */ }
    for (const ob of this.o.observers ?? []) { try { ob(this.me, ev); } catch { /* an observer never breaks the transcript */ } }
    if (ev.type === 'turn.done') void this.cp?.endTurn().catch(() => undefined);
    const me = this.me;
    switch (ev.type) {
      case 'session.started':
        this.updateAgent(me, () => ({ model: ev.model, loginKind: ev.login_kind, engine: this.o.engine.label }));
        break;
      case 'turn.started':
        this.set({ busy: true, turnStartedAt: Date.now(), verb: this.verbs.next() }); this.updateAgent(me, () => ({ busy: true })); break;
      case 'status': this.setAgentState(me, ev.state); break;
      case 'text.delta': {
        const exists = this.state.items.some((i) => i.kind === 'assistant' && i.messageId === ev.message_id);
        if (!exists) this.addItem({ kind: 'assistant', id: nid('a'), messageId: ev.message_id, agentId: me, text: ev.text, done: false });
        else this.patchItem((i) => i.kind === 'assistant' && i.messageId === ev.message_id, (i) => (i.kind === 'assistant' ? { ...i, text: i.text + ev.text } : i));
        break;
      }
      case 'text.done': this.patchItem((i) => i.kind === 'assistant' && i.messageId === ev.message_id, (i) => (i.kind === 'assistant' ? { ...i, done: true } : i)); break;
      case 'thinking.delta': {
        const exists = this.state.items.some((i) => i.kind === 'thinking' && i.messageId === ev.message_id);
        if (!exists) this.addItem({ kind: 'thinking', id: nid('t'), messageId: ev.message_id, agentId: me, text: ev.text, ms: Date.now(), done: false });
        else this.patchItem((i) => i.kind === 'thinking' && i.messageId === ev.message_id, (i) => (i.kind === 'thinking' ? { ...i, text: i.text + ev.text } : i));
        break;
      }
      case 'tool.requested':
        this.set((s) => ({ items: [...s.items.map((i) => (i.kind === 'thinking' && !i.done ? { ...i, done: true, ms: Date.now() - i.ms } : i)),
          { kind: 'tool', id: nid('x'), toolId: ev.tool_id, agentId: me, name: ev.name, summary: ev.input_summary, risk: ev.risk, status: 'running', path: ev.path, command: ev.command, startedAt: Date.now() }] }));
        break;
      case 'approval.requested': this.patchItem((i) => i.kind === 'tool' && i.toolId === ev.tool_id, (i) => (i.kind === 'tool' ? { ...i, approval: 'pending', diff: ev.diff ?? i.diff } : i)); break;
      case 'approval.resolved': this.patchItem((i) => i.kind === 'tool' && i.approval === 'pending', (i) => (i.kind === 'tool' ? { ...i, approval: ev.decision === 'approve' ? 'approved' : 'denied' } : i)); break;
      case 'tool.result': this.patchItem((i) => i.kind === 'tool' && i.toolId === ev.tool_id, (i) => (i.kind === 'tool' ? { ...i, status: ev.status, result: ev.summary, diff: ev.diff ?? i.diff } : i)); break;
      case 'usage.report': this.updateAgent(me, () => ({ cost: ev.cost_usd ?? 0, inTok: ev.input_tokens, outTok: ev.output_tokens, ...(ev.context_used_pct !== undefined ? { ctxPct: ev.context_used_pct, ctxTokens: ev.context_tokens, ctxWindow: ev.context_window } : {}) })); break;
      case 'limits.report': this.set({ limits: ev.windows }); break;
      case 'tasks.updated': this.set((st) => ({ tasks: reduceTasks({ items: st.tasks }, { tasks: ev.tasks }).items })); break;
      case 'compaction.ended': this.notice('info', `Compacted the context${ev.tokens_before ? ` (${Math.round(ev.tokens_before / 1000)}k → ${Math.round((ev.tokens_after ?? 0) / 1000)}k tokens)` : ''}.`); break;
      case 'question.asked': this.notice('info', ev.text, ev.options?.join('  ·  ')); break;
      case 'engine.warning': this.notice('warn', ev.text); break;
      case 'error':
        if (ev.retry) { this.toast('warn', `Retrying (${ev.retry.attempt}/${ev.retry.max_retries})…`); break; }
        this.addItem({ kind: 'notice', id: nid('n'), level: 'error', text: errorTitle(ev.code), detail: ev.tool_message });
        break;
      case 'turn.done':
        this.set((s) => ({ busy: false, turnStartedAt: undefined, items: s.items.map((i) => (i.kind === 'thinking' && !i.done ? { ...i, done: true, ms: Date.now() - i.ms } : i.kind === 'tool' && i.status === 'running' && ev.outcome === 'canceled' ? { ...i, status: 'canceled' as const } : i)) }));
        this.updateAgent(me, () => ({ busy: false }));
        if (ev.outcome === 'canceled') { this.notice('warn', 'Interrupted.'); this.setAgentState(me, 'idle'); }
        break;
      default: break;
    }
  }

  private setAgentState(id: string, state: string) {
    this.updateAgent(id, () => ({ state, mini: stateToMini(state) }));
    if (id === this.state.activeAgent) {
      const wasBusy = this.state.busy;
      this.driver.setState(state === 'idle' && wasBusy ? 'idle' : state);
    }
    if (id === this.me) this.set({ busy: isBusyState(state) || this.state.busy });
  }

  private logEvent(ev: NormalisedEvent) {
    const l = this.o.logger; if (!l) return;
    switch (ev.type) {
      case 'session.started': l.info('engine.session_started', { engine: ev.engine, model: ev.model, login_kind: ev.login_kind, cli_version: ev.cli_version }); break;
      case 'turn.started': l.info('turn.started'); break;
      case 'turn.done': l.info('turn.done', { outcome: ev.outcome, stop_reason: ev.stop_reason }); break;
      case 'tool.requested': l.debug('tool.requested', { tool: ev.name, risk: ev.risk }); break;
      case 'tool.result': l.debug('tool.result', { status: ev.status }); break;
      case 'approval.requested': l.info('approval.requested', { risk: ev.risk }); break;
      case 'approval.resolved': l.info('approval.resolved', { decision: ev.decision, scope: ev.scope, by: ev.by }); break;
      case 'error': l.error('engine.error', { code: ev.code, fatal: ev.fatal }); break;
      case 'engine.warning': l.warn('engine.warning', { code: ev.code }); break;
      case 'limits.report': l.debug('limits.report', { windows: ev.windows.map((w) => ({ name: w.name, utilization: w.utilization })) }); break;
      default: break;
    }
  }

  /* ------------------------------------------------------------------ approvals (permission policy) */
  private ruleKey(r: ApprovalRequest) { return `${r.tool}:${r.command ?? r.path ?? ''}`; }
  decide(r: ApprovalRequest): Promise<ApprovalDecision> {
    if (this.o.policy) return this.decideWithPolicy(r);
    const mode = this.state.settings.permissionMode;
    if (mode === 'bypassPermissions') return Promise.resolve({ decision: 'approve', scope: 'once' }); // the user turned approvals off
    const write = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(r.tool);
    if (this.sessionRules.has(this.ruleKey(r)) && r.risk !== 'high') return Promise.resolve({ decision: 'approve', scope: 'session' });
    if (mode === 'plan' && (write || r.tool === 'Bash') && r.risk !== 'low') return Promise.resolve({ decision: 'deny', scope: 'once', reason: 'plan mode is read-only' });
    if (r.risk === 'low') return Promise.resolve({ decision: 'approve', scope: 'once' });
    if (mode === 'acceptEdits' && write && r.risk !== 'high') return Promise.resolve({ decision: 'approve', scope: 'once' });
    return new Promise((resolve) => {
      const me = this.state.agents.find((a) => a.id === r.agent_id);
      const pending: PendingApproval = { req: r, agentName: me?.name ?? 'agent', color: me?.color ?? 'violet', resolve, confirmHigh: r.risk === 'high' };
      this.set((s) => ({ approvals: [...s.approvals, pending] }));
    });
  }

  private async decideWithPolicy(r: ApprovalRequest): Promise<ApprovalDecision> {
    const p = this.o.policy!; this.pendingReqs.set(r.approval_id, r);
    try {
      const d = await p.engine.handle(r, { agentId: this.me, root: p.root, mode: POLICY_MODE[this.state.settings.permissionMode], engine: this.o.engine.id as EngineId });
      if (d.decision === 'deny' && d.reason && HARD_DENY[d.reason]) this.notice('warn', `Blocked: ${r.tool}${r.command ? ` \`${r.command.slice(0, 80)}\`` : r.path ? ` ${r.path}` : ''}`, `Centcom never allows this, in any mode, because ${HARD_DENY[d.reason]}.`);
      else if (d.decision === 'deny' && d.reason === 'plan_mode') this.toast('info', 'Plan mode is read-only: that change was not made.');
      return d;
    } finally { this.pendingReqs.delete(r.approval_id); }
  }
  /** The policy engine's prompter: shows the approval and waits for an answer (or for the engine to cancel it). */
  promptApproval(p: PolicyPending, signal: AbortSignal): Promise<ApprovalDecision> {
    const req: ApprovalRequest = { ...(this.pendingReqs.get(p.approval_id) ?? { approval_id: p.approval_id, agent_id: p.agent_id, tool_id: p.approval_id, tool: p.tool, summary: p.summary, ...(p.command ? { command: p.command } : {}), ...(p.path ? { path: p.path } : {}), ...(p.cwd ? { cwd: p.cwd } : {}) }), risk: p.risk };
    return new Promise((resolve) => {
      const me = this.state.agents.find((a) => a.id === req.agent_id);
      const pending: PendingApproval = { req, agentName: me?.name ?? 'agent', color: me?.color ?? 'violet', resolve, confirmHigh: req.risk === 'high' };
      signal.addEventListener('abort', () => { this.set((s) => ({ approvals: s.approvals.filter((a) => a !== pending) })); resolve({ decision: 'deny', scope: 'once', reason: 'cancelled' }); }, { once: true });
      this.set((s) => ({ approvals: [...s.approvals, pending] }));
    });
  }

  answerApproval(decision: 'approve' | 'deny', scope: 'once' | 'session' | 'always' = 'once') {
    const [first, ...rest] = this.state.approvals;
    if (!first) return;
    if (decision === 'approve' && scope !== 'once' && !this.o.policy) this.sessionRules.add(this.ruleKey(first.req)); // with the policy engine, it saves the rule itself
    this.set({ approvals: rest });
    first.resolve({ decision, scope });
    this.driver.setState(decision === 'approve' ? 'approved' : 'denied');
  }

  /* ------------------------------------------------------------------ user actions */
  /** History navigation for the prompt. */
  historyStep(dir: -1 | 1) {
    const s = this.state; if (!s.history.length) return;
    let idx = s.histIdx; let draft = s.draft;
    if (idx === null) { if (dir === 1) return; draft = s.input; idx = s.history.length - 1; } else { idx += dir; }
    if (idx >= s.history.length) { this.patch({ histIdx: null, input: draft, cursor: draft.length }); return; }
    idx = Math.max(0, idx); const t = s.history[idx]!;
    this.patch({ histIdx: idx, draft, input: t, cursor: t.length });
  }

  /** A question waiting for y (memory notes, rewinds): the answer never goes to the engine or into history. */
  private pendingMemory?: { diff: string; apply: () => Promise<string>; no?: string };
  async submit(raw: string) {
    const text = raw.trim();
    if (!text) return;
    if (this.pendingMemory) { // the answer to "add this to memory?": never goes to the engine or into the prompt history
      const p = this.pendingMemory; this.pendingMemory = undefined; this.set({ input: '', cursor: 0 });
      if (/^(y|yes)$/i.test(text)) { try { this.addItem({ kind: 'notice', id: nid('n'), level: 'ok', text: await p.apply() }); } catch (e) { this.addItem({ kind: 'notice', id: nid('n'), level: 'warn', text: String((e as Error).message ?? e) }); } } else this.addItem({ kind: 'notice', id: nid('n'), level: 'info', text: p.no ?? 'Nothing was added to memory.' });
      return;
    }
    const note = this.o.onMemoryAdd ? /^#[ \t]+(\S[\s\S]*)$/.exec(text) : null;
    if (note) {
      this.set({ input: '', cursor: 0, histIdx: null, draft: '' }); const r = await this.o.onMemoryAdd!(note[1]!.trim());
      if ('error' in r) this.addItem({ kind: 'notice', id: nid('n'), level: 'warn', text: r.error }); else { this.pendingMemory = r; this.addItem({ kind: 'notice', id: nid('n'), level: 'info', text: 'Add this note to memory? Type y to confirm, anything else cancels.', detail: r.diff }); }
      return;
    }
    this.set((s) => ({ history: [...s.history.filter((h) => h !== text), text].slice(-200), histIdx: null, draft: '', input: '', cursor: 0, scroll: 0, slashSel: 0 }));
    this.o.onHistory?.(this.state.history);
    if (text.startsWith('/')) { await this.runCommand(text); return; }
    if (this.state.busy) { this.toast('warn', 'Cento is still working. Press Esc to interrupt, then send again.'); return; }
    this.addItem({ kind: 'user', id: nid('u'), text, ts: Date.now() });
    this.setAgentState(this.me, 'prompt-received');
    let outgoing = text;
    if (this.state.settings.autoSkills) {
      const picks = match(text, this.skills());
      if (picks.length) {
        this.addItem({ kind: 'notice', id: nid('n'), level: 'info', text: 'auto skills: ' + picks.map((p) => (p.skill.kind === 'command' ? '/' : '') + p.skill.name).join(' · '), detail: picks.map((p) => `${p.skill.name}: matched ${p.why.join(', ')}`).join('\n') });
        if (!this.o.demo) outgoing = injection(picks) + text;
      }
    }
    await this.checkpointBefore(text);
    try { await this.session?.send(outgoing); } catch (e) { this.addItem({ kind: 'notice', id: nid('n'), level: 'error', text: 'Could not send the prompt', detail: String(e) }); }
  }

  /** Switch model for the next turn (the running turn keeps its model). */
  setModel(id: string) {
    this.setSettings({ model: id }); this.session?.setModel?.(id);
    this.updateAgent(this.me, () => ({ model: id || 'default' }));
    this.toast('ok', `Model: ${id ? modelLabel(id) : 'Default'}${this.state.busy ? ' (from the next message)' : ''}`);
  }

  private skillCache?: Skill[];
  /** Your own skills first; bundled ones fill in, skipping any you already have under the same name. */
  private loadSkills(): Skill[] {
    const own = discover({ cwd: this.o.cwd }); const have = new Set(own.map((k) => k.name.toLowerCase()));
    return [...own, ...masterSkills().filter((k) => !have.has(k.name.split('--').slice(1).join('--').toLowerCase()))];
  }
  skills(): Skill[] { return (this.skillCache ??= this.o.skills ?? this.loadSkills()); }

  async interrupt() {
    if (!this.state.busy) return;
    for (const a of this.state.approvals) a.resolve({ decision: 'deny', scope: 'once', reason: 'interrupt' });
    this.set({ approvals: [] });
    await this.session?.interrupt();
  }

  /** Ctrl+C: interrupt if busy, otherwise press twice within 2 s to quit. */
  ctrlC() {
    const now = Date.now();
    if (this.state.busy) { void this.interrupt(); this.lastExitPress = now; this.toast('info', 'Interrupted. Press Ctrl+C again to quit.'); return; }
    if (now - this.lastExitPress < 2000) { this.o.onExit?.(); return; }
    this.lastExitPress = now; this.toast('info', 'Press Ctrl+C again to quit.');
  }

  cycleMode() {
    const cur = this.state.settings.permissionMode;
    const order: PermissionMode[] = this.o.dangerous || cur === 'bypassPermissions' ? [...MODES, 'bypassPermissions'] : MODES;
    this.setMode(order[(order.indexOf(cur) + 1) % order.length]!);
  }

  /** Change how permissions are asked. Switching to bypass is explicit, loud and reversible. */
  setMode(m: PermissionMode) {
    const prev = this.state.settings.permissionMode; if (m === prev) return;
    this.setSettings({ permissionMode: m }); this.session?.setPermissionMode?.(m); this.o.logger?.info('permission_mode.changed', { from: prev, to: m });
    if (m === 'bypassPermissions') {
      this.addItem({ kind: 'notice', id: nid('n'), level: 'warn', text: 'Dangerously skip permissions is ON', detail: 'Cento will run commands and edit files without asking, including destructive ones. Use /mode default to turn approvals back on.' });
      this.driver.setState('warning');
    } else if (prev === 'bypassPermissions') this.toast('ok', `Approvals are back on (${modeLabel(m)})`);
    else this.toast('info', modeLabel(m));
  }

  setSettings(p: Partial<Settings>) {
    this.set((s) => ({ settings: { ...s.settings, ...p } }));
    if (p.color) this.driver.setColor(p.color);
    if (p.reducedMotion !== undefined) this.driver.setReducedMotion(p.reducedMotion);
  }

  async runCommand(line: string) {
    const [cmd, ...rest] = line.slice(1).trim().split(/\s+/); const arg = rest.join(' ');
    const known = COMMANDS.find((c) => c.name === cmd);
    if (!known) { this.toast('warn', `Unknown command /${cmd}. Type / to see the list.`); return; }
    switch (cmd) {
      case 'help': this.set({ mode: 'help' }); break;
      case 'clear': case 'new': await this.newSession(); break;
      case 'resume': if (arg) await this.resumeSession(arg); else this.listSessions(); break;
      case 'agents': this.set((s) => ({ fleet: !s.fleet })); break;
      case 'quit': this.o.onExit?.(); break;
      case 'interrupt': await this.interrupt(); break;
      case 'rewind': await this.rewindCommand(arg); break;
      case 'compact': await this.compactCommand(); break;
      case 'fleet': await this.fleetCommand(arg); break;
      case 'mcp': case 'hooks': case 'memory': {
        const view = this.o.views?.[cmd]; if (!view) { this.toast('info', `/${cmd} is not available here. Use \`centcom ${cmd}\` in a terminal.`); break; }
        const lines = await view(arg.split(/\s+/).filter(Boolean)).catch((e: unknown) => [String((e as Error)?.message ?? e)]); this.notice('info', lines[0] ?? `(nothing to show)`, lines.slice(1).join('\n') || undefined); break;
      }
      case 'permissions': await this.permissionsCommand(arg); break;
      case 'trust': await this.trustCommand(arg); break;
      case 'mode': {
        const alias: Record<string, PermissionMode> = { bypass: 'bypassPermissions', yolo: 'bypassPermissions', skip: 'bypassPermissions', dangerous: 'bypassPermissions', ask: 'default', edits: 'acceptEdits', accept: 'acceptEdits' };
        const m = (alias[arg.toLowerCase()] ?? arg) as PermissionMode;
        if (MODES.concat('bypassPermissions').includes(m)) this.setMode(m); else this.toast('info', `Mode: ${modeLabel(this.state.settings.permissionMode)}. Try /mode plan, /mode edits or /mode bypass`);
        break;
      }
      case 'mascot': if (['large', 'small', 'off', 'auto'].includes(arg)) this.setSettings({ mascot: arg as Settings['mascot'] }); else this.toast('info', 'Try /mascot large, small, off or auto'); break;
      case 'color': if (['violet', 'red', 'yellow', 'green', 'brown'].includes(arg)) this.setSettings({ color: arg as CentoColor }); else this.toast('info', 'Colours: violet red yellow green brown'); break;
      case 'theme': if (arg === 'dark' || arg === 'light') this.setSettings({ theme: arg }); else this.toast('info', 'Try /theme dark or /theme light'); break;
      case 'model': {
        if (!arg) { const i = CLAUDE_MODELS.findIndex((m) => m.id === this.state.settings.model); this.set({ mode: 'models', modelSel: Math.max(0, i) }); break; }
        const q = arg.toLowerCase(); const m = CLAUDE_MODELS.find((x) => x.id.toLowerCase() === q || x.label.toLowerCase() === q) ?? CLAUDE_MODELS.find((x) => (x.id + ' ' + x.label).toLowerCase().includes(q));
        if (m) this.setModel(m.id); else if (/^[\w.:-]{3,}$/.test(arg)) this.setModel(arg); else this.toast('warn', `No model called "${arg}"`);
        break;
      }
      case 'config': this.addItem({ kind: 'notice', id: nid('n'), level: 'info', text: 'Settings in effect (where each value comes from)', detail: this.o.describeConfig?.() ?? 'Settings are not saved in this session.' }); break;
      case 'auto': {
        const on = arg ? arg === 'on' : !this.state.settings.autoSkills; this.setSettings({ autoSkills: on });
        this.toast('info', on ? `Auto skills on (${this.skills().length} found)` : 'Auto skills off'); break;
      }
      case 'skills': {
        const sub = /^(enable|disable)\s+(.+)$/i.exec(arg);
        if (sub) { this.toast('info', setEnabled(sub[2]!.trim(), sub[1]!.toLowerCase() === 'enable')); this.skillCache = undefined; break; }
        const f = arg.toLowerCase(); const all = this.skills().filter((k) => !f || (k.name + ' ' + k.description).toLowerCase().includes(f));
        this.addItem({ kind: 'notice', id: nid('n'), level: 'info', text: `${all.length} skill${all.length === 1 ? '' : 's'} and commands${f ? ` matching "${f}"` : ''} · auto skills ${this.state.settings.autoSkills ? 'on' : 'off'}`, detail: all.slice(0, 14).map((k) => `${k.kind === 'command' ? '/' : ''}${k.name}  (${k.source})`).join('\n') + (all.length > 14 ? `\n+${all.length - 14} more` : '') });
        break;
      }
      case 'motion': this.setSettings({ reducedMotion: arg === 'reduced' }); this.toast('info', arg === 'reduced' ? 'Animation off' : 'Animation on'); break;
      case 'cento': {
        const cats = bakedCategories(); const a = getBaked(arg.trim());
        const cat = a ? Math.max(0, cats.indexOf(a.cat)) : 0; const idx = a ? Math.max(0, bakedByCategory(cats[cat]!).findIndex((x) => x.name === a.name)) : 0;
        this.set({ mode: 'gallery', gallery: { cat, idx, color: 0, query: '' } }); break;
      }
      case 'demo': {
        if (!this.state.demo) { this.toast('warn', 'Demo stories need `centcom --demo`.'); break; }
        const story = DEMO_PROMPTS[arg] ?? DEMO_PROMPTS.fix!; this.set({ input: '', cursor: 0 }); await this.submit(story); break;
      }
    }
  }

  /* ------------------------------------------------------------------ fleet */
  private fleetIds: string[] = [];
  private watchFleet(f: NonNullable<ControllerOptions['fleet']>) {
    f.bus.on('fleet:node', ({ node }) => { if (node.kind === 'agent') this.upsertFleetAgent(node); });
    f.bus.on('agent:event', ({ agent_id, event: ev }) => {
      if (!this.fleetIds.includes(agent_id)) return;
      if (ev.type === 'status') this.updateAgent(agent_id, () => ({ state: ev.state, mini: stateToMini(ev.state), busy: isBusyState(ev.state) }));
      else if (ev.type === 'session.started') this.updateAgent(agent_id, () => ({ model: ev.model, loginKind: ev.login_kind }));
      else if (ev.type === 'usage.report') this.updateAgent(agent_id, (a) => ({ cost: a.cost + (ev.cost_usd ?? 0), inTok: a.inTok + ev.input_tokens, outTok: a.outTok + ev.output_tokens }));
      else if (ev.type === 'approval.requested') this.toast('warn', `${this.state.agents.find((a) => a.id === agent_id)?.name ?? 'An agent'} needs approval`, 5000);
    });
    f.bus.on('fleet:branch_ready', (e) => { const n = this.fleetIds.indexOf(e.agentId) + 1; this.notice('ok', `Agent ${n} finished: branch ${e.branch} is ready (${e.ahead} commit${e.ahead === 1 ? '' : 's'}, ${e.files.length} file${e.files.length === 1 ? '' : 's'}).`, `/fleet preview ${n} checks it for conflicts with its base. Centcom never merges or pushes for you.`); });
  }
  private upsertFleetAgent(n: FleetNode) {
    const i = this.fleetIds.indexOf(n.id); const state = n.state === 'running' || n.state === 'waiting' ? (this.state.agents.find((a) => a.id === n.id)?.state ?? FLEET_STATE[n.state]!) : FLEET_STATE[n.state] ?? 'idle';
    const view: Partial<AgentView> = { name: `${i < 0 ? this.fleetIds.length + 1 : i + 1} ${n.label}`, state, mini: n.state === 'queued' ? 'waiting' : stateToMini(state), busy: n.state === 'starting' || n.state === 'running', branch: n.branch ?? '', note: n.attention ?? (n.error_code ? `failed: ${n.error_code}` : n.state === 'queued' ? 'waiting for a slot' : undefined) };
    if (i < 0) { this.fleetIds.push(n.id); this.set((s) => ({ agents: [...s.agents, { id: n.id, color: FLEET_COLORS[(this.fleetIds.length - 1) % FLEET_COLORS.length]!, mine: false, engine: this.o.engine.label, provider: this.o.engine.provider, model: '', loginKind: 'unknown', runsOn: 'you', cost: 0, inTok: 0, outTok: 0, name: '', state: 'idle', mini: 'idle', busy: false, branch: '', ...view } as AgentView] })); }
    else this.updateAgent(n.id, () => view);
    if (n.state === 'failed') this.notice('warn', `Agent ${this.fleetIds.indexOf(n.id) + 1} (${n.label}) stopped with an error${n.error_code ? `: ${n.error_code}` : ''}.`);
  }
  private fleetAgent(nArg: string | undefined): FleetNode | undefined { const n = Number(nArg); const id = Number.isInteger(n) ? this.fleetIds[n - 1] : undefined; return id ? this.o.fleet!.manager.list().find((x) => x.id === id) : undefined; }
  private async fleetCommand(arg: string) {
    const f = this.o.fleet; if (!f) { this.toast('info', this.o.demo ? 'The fleet needs a real engine (not the demo).' : 'Parallel agents are off in this session.'); return; }
    const [sub = 'list', ...rest] = arg.split(/\s+/).filter(Boolean);
    try {
      switch (sub) {
        case 'list': { const nodes = f.manager.list().filter((n) => n.kind === 'agent'); this.notice('info', nodes.length ? `${nodes.length} fleet agent${nodes.length === 1 ? '' : 's'}` : 'No fleet agents yet. /fleet start [count] <task> runs agents in parallel, each on its own branch.', nodes.map((n) => `${this.fleetIds.indexOf(n.id) + 1}. ${n.label}  ${n.state}${n.branch ? `  ${n.branch}` : ''}${n.attention ? `  [${n.attention}]` : ''}${n.error_code ? `  (${n.error_code})` : ''}`).join('\n') || undefined); for (const p of f.manager.paused()) this.notice('warn', `New ${p.engine} agents are paused`, p.message); break; }
        case 'start': {
          const count = /^\d+$/.test(rest[0] ?? '') ? Math.min(16, Math.max(1, Number(rest.shift()))) : 1; const task = rest.join(' ').trim(); if (!task) { this.toast('info', 'Usage: /fleet start [count] <task>'); return; }
          const label = task.split(/\s+/).slice(0, 4).join(' '); this.set({ fleet: true });
          for (let i = 1; i <= count; i++) { const h = await f.manager.spawn({ repoRoot: this.o.cwd, engine: this.o.engine.id, prompt: task, ownerSlug: f.ownerSlug, label: count > 1 ? `${label} ${i}` : label, ...(this.state.settings.model ? { model: this.state.settings.model } : {}) }); void h.done().then((r) => { if (r.outcome !== 'ok' && r.error_code === 'fleet_timeout') this.notice('warn', `Agent ${this.fleetIds.indexOf(h.id) + 1} was stopped after its time limit.`); }); }
          this.toast('ok', `Started ${count} agent${count === 1 ? '' : 's'} on their own branches.`); break;
        }
        case 'stop': { if (rest[0] === 'all') { await f.manager.stopAll(); this.toast('ok', 'All fleet agents stopped.'); break; } const n = this.fleetAgent(rest[0]); if (!n) { this.toast('warn', 'Which agent? /fleet stop <number> or /fleet stop all'); return; } await f.manager.stop(n.id as AgentId); this.toast('ok', `Agent ${rest[0]} stopped.`); break; }
        case 'preview': { const n = this.fleetAgent(rest[0]); if (!n) { this.toast('warn', 'Which agent? /fleet preview <number>'); return; } const r = await f.manager.mergePreview(n.id as AgentId); this.notice(r.conflicts.length ? 'warn' : 'ok', r.conflicts.length ? `Merging ${n.branch} would conflict in ${r.conflicts.length} file${r.conflicts.length === 1 ? '' : 's'}.` : `${n.branch} merges cleanly into its base.`, r.conflicts.join('\n') || undefined); break; }
        case 'remove': { const n = this.fleetAgent(rest[0]); if (!n) { this.toast('warn', 'Which agent? /fleet remove <number> [force]'); return; } await f.manager.remove(n.id as AgentId, { force: rest[1] === 'force' }); this.fleetIds = this.fleetIds.map((x) => (x === n.id ? '' : x)); this.set((s) => ({ agents: s.agents.filter((a) => a.id !== n.id) })); this.toast('ok', `Agent ${rest[0]} and its worktree were removed.`); break; }
        case 'clean': { const o = await f.manager.recoverOrphans(this.o.cwd); this.notice('info', o.length ? `${o.length} worktree${o.length === 1 ? '' : 's'} left from an earlier run. Nothing was removed.` : 'Nothing left over from earlier runs.', o.map((w) => `${w.branch}  ${w.path}`).join('\n') || undefined); break; }
        case 'resume': { const engine = rest[0] === 'codex' ? 'codex' : 'claude-code'; f.manager.resume(engine); this.toast('ok', `New ${engine} agents may start again.`); break; }
        default: this.toast('info', 'Try /fleet, /fleet start [count] <task>, /fleet stop <n|all>, /fleet preview <n>, /fleet remove <n>, /fleet clean');
      }
    } catch (e) { this.notice('warn', String((e as Error).message ?? e)); }
  }

  /* ------------------------------------------------------------------ checkpoints and rewind */
  /** A snapshot of the folder before the prompt goes out (so before any tool runs). Never holds the prompt up for more than 3 s. */
  private async checkpointBefore(text: string) {
    if (!this.cp) return; const seq = this.state.items.filter((i) => i.kind === 'user').length; const sid = this.session?.resumeToken();
    let timer: NodeJS.Timeout | undefined; const late = new Promise<void>((r) => { timer = setTimeout(r, 3000); timer.unref?.(); });
    await Promise.race([this.cp.create(text, { promptSeq: seq, ...(sid ? { engineSession: { id: sid } } : {}) }).catch(() => undefined), late]); clearTimeout(timer);
  }
  /** Conversation rewind: keep what came before the prompt with number `seq` (1 = the first prompt). */
  private rewindTranscript(seq: number) {
    let n = 0; const keep: Item[] = []; for (const it of this.state.items) { if (it.kind === 'user' && ++n >= seq) break; keep.push(it); }
    this.lastItems = undefined; this.set({ items: keep, scroll: 0, approvals: [] });
  }
  /** Plain text of the conversation before prompt `seq`, newest kept when it is too long. */
  private summaryUpTo(seq: number, maxBytes: number): string {
    let n = 0; const lines: string[] = [];
    for (const it of this.state.items) { if (it.kind === 'user') { if (++n >= seq) break; lines.push(`User: ${it.text}`); } else if (it.kind === 'assistant') lines.push(`Assistant: ${it.text}`); else if (it.kind === 'tool') lines.push(`(tool ${it.name}: ${it.summary}${it.status ? `, ${it.status}` : ''})`); }
    let out = lines.join('\n'); while (Buffer.byteLength(out) > maxBytes && lines.length) { lines.shift(); out = '…\n' + lines.join('\n'); } return Buffer.byteLength(out) > maxBytes ? out.slice(-Math.floor(maxBytes / 4)) : out;
  }
  private checkpointLine(c: Checkpoint, i: number) { return `${String(c.n).padStart(3)}  ${ago(Date.parse(c.at))}  ${c.label || '(no text)'}${c.commit ? `  +${c.files.added} ~${c.files.changed} -${c.files.removed}` : '  (conversation only)'}${i === 0 ? '  ← latest' : ''}`; }
  async rewindCommand(arg: string) {
    if (!this.cp) { this.toast('info', 'Checkpoints are off in this session.'); return; }
    if (this.state.busy) { this.toast('warn', 'Cento is still working. Press Esc to interrupt, then rewind.'); return; }
    await this.cp.ready().catch(() => undefined); const list = [...this.cp.list()].reverse();
    const [nArg, modeArg] = arg.split(/\s+/).filter(Boolean);
    if (!nArg) { if (!list.length) { this.notice('info', 'No checkpoints yet. One is saved before every prompt.'); return; } this.notice('info', 'Checkpoints (newest first). Type /rewind <number> to go back to before that prompt; add "conversation" or "both" to also rewind the conversation.', list.slice(0, 15).map((c, i) => this.checkpointLine(c, i)).join('\n')); return; }
    const mode = (modeArg ?? 'files') as RewindMode; if (!['files', 'conversation', 'both'].includes(mode)) { this.toast('warn', 'Rewind what: files, conversation or both?'); return; }
    const target = list.find((c) => String(c.n) === nArg); if (!target) { this.toast('warn', `No checkpoint ${nArg}. Type /rewind to see the list.`); return; }
    let plan; try { plan = await this.cp.preview(target.id, mode); } catch (e) { this.notice('warn', 'Cannot rewind files here.', String((e as Error).message ?? e)); return; }
    const parts: string[] = []; if (plan.restore.length) parts.push(`Put back ${plan.restore.length} file${plan.restore.length === 1 ? '' : 's'}: ${plan.restore.slice(0, 10).join(', ')}`); if (plan.delete.length) parts.push(`Delete ${plan.delete.length} file${plan.delete.length === 1 ? '' : 's'} made since: ${plan.delete.slice(0, 10).join(', ')}`);
    if (plan.skippedModifiedOutside.length) parts.push(`Left alone (changed by someone else since): ${plan.skippedModifiedOutside.slice(0, 10).join(', ')}`);
    if (plan.conversation !== 'none') parts.push(plan.conversation === 'engine-resume' ? 'The conversation goes back to that point.' : 'The conversation starts again from a short summary of what came before.');
    if (mode !== 'conversation') parts.push('Only files in this folder are put back. What commands did elsewhere (installs, network, databases) is not undone.');
    if (!plan.restore.length && !plan.delete.length && plan.conversation === 'none') { this.notice('info', 'Nothing to put back: the files are already as they were then.', plan.skippedModifiedOutside.length ? parts.join('\n') : undefined); return; }
    this.pendingMemory = { diff: parts.join('\n'), no: 'Nothing was rewound.', apply: async () => {
      const r = await this.cp!.rewind(target.id, mode);
      if (r.conversation) { void this.session?.stop(); this.adopt(r.conversation.session); }
      if (r.failed) return `Stopped part way: ${r.failed.unrestored.length} file(s) not put back. Your state before the rewind is saved: /rewind ${this.cp!.list().at(-1)?.n ?? ''} undoes it.`;
      return `Rewound to before "${target.label}": ${r.restored.length} put back, ${r.deleted.length} removed${r.skipped.length ? `, ${r.skipped.length} left alone` : ''}.${r.undoRef ? ` To undo, /rewind ${this.cp!.list().at(-1)?.n}.` : ''}${r.conversation?.resumeError ? ` (The tool said: ${r.conversation.resumeError})` : ''}`;
    } };
    this.addItem({ kind: 'notice', id: nid('n'), level: 'info', text: `Rewind to before "${target.label}"? Type y to confirm, anything else cancels.`, detail: parts.join('\n') });
  }
  /** Esc twice within 600 ms while idle opens the checkpoint list. */
  escIdle() { const now = Date.now(); if (now - this.lastEsc < 600) { this.lastEsc = 0; void this.rewindCommand(''); } else this.lastEsc = now; }

  /* ------------------------------------------------------------------ permissions */
  private async permissionsCommand(arg: string) {
    const p = this.o.policy; if (!p) { this.toast('info', 'Saved permission rules are not used in this session.'); return; }
    const [sub, id] = arg.split(/\s+/).filter(Boolean);
    if (sub === 'remove' && id) { const ok = await p.engine.rules.remove(id); this.toast(ok ? 'ok' : 'warn', ok ? `Rule ${id} removed.` : `There is no rule ${id}.`); return; }
    const rules = p.engine.rules.list(p.root); const warn = p.engine.rules.warnings(); const trust = p.engine.rules.needsTrust();
    this.notice('info', rules.length ? `${rules.length} permission rule${rules.length === 1 ? '' : 's'} (checked before the mode)` : 'No permission rules yet. Answering "always" to an approval saves one for this project.', [...rules.map((r) => `${r.id}  ${r.action.padEnd(5)} ${r.tool}${r.matcher?.command ? ` ${r.matcher.command}` : ''}${r.matcher?.path_glob ? ` ${r.matcher.path_glob}` : ''}  (${r.scope})`), ...warn.map((w) => `! ${w}`), ...(trust.length ? ['! This project has its own rules file that you have not trusted yet: /trust rules to use it.'] : []), ...(rules.length ? ['Remove one with /permissions remove <id>.'] : [])].join('\n') || undefined);
  }
  private async trustCommand(arg: string) {
    const p = this.o.policy; if (!p || arg.trim() !== 'rules') { this.toast('info', 'Try /trust rules to use this project\'s permission rules file.'); return; }
    try { await p.engine.rules.trustProject(p.root); this.toast('ok', 'Project rules trusted and loaded.'); } catch (e) { this.toast('warn', String((e as Error).message ?? e)); }
  }
  private async compactCommand() {
    const r = await this.ctxView!.requestCompaction(this.me as AgentId);
    if (r.ok) this.notice('info', 'Asked the agent to compact its context.'); else this.toast('warn', r.reason === 'unsupported' ? `${this.o.engine.label} has no compact command Centcom can use.` : r.reason === 'busy' ? 'Wait until the agent is idle, then /compact.' : r.reason === 'failed' ? 'The compact request did not go through. Try again in a minute.' : 'The agent is not running.');
  }

  toast(level: 'info' | 'ok' | 'warn' | 'error', text: string, ms = 3800) {
    const id = nid('toast');
    this.set((s) => ({ toasts: [...s.toasts.slice(-2), { id, level, text, until: Date.now() + ms }] }));
    this.toastTimers.set(id, setTimeout(() => { this.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })); this.toastTimers.delete(id); }, ms));
  }
  notice(level: 'info' | 'warn' | 'error' | 'ok', text: string, detail?: string) { this.addItem({ kind: 'notice', id: nid('n'), level, text, ...(detail ? { detail } : {}) }); }

  /* ------------------------------------------------------------------ demo teammates */
  private startGhosts() {
    const ghosts: { id: string; name: string; color: CentoColor; branch: string; steps: [string, number][] }[] = [
      { id: 'agt_maya', name: 'maya', color: 'green', branch: 'agent/fix-flaky-test', steps: [['thinking', 3500], ['reading-file', 3000], ['editing-file', 4500], ['awaiting-approval', 9000], ['running-command', 5000], ['success', 3500], ['idle', 5000]] },
      { id: 'agt_sam', name: 'sam', color: 'yellow', branch: 'agent/docs-pass', steps: [['idle', 6000], ['reading-file', 3500], ['editing-file', 5200], ['running-command', 3500], ['success', 3500], ['idle', 3000]] },
    ];
    this.set((s) => ({ agents: [...s.agents, ...ghosts.map((g): AgentView => ({ id: g.id, name: g.name, color: g.color, mine: false, engine: 'Claude Code', provider: 'anthropic', model: 'claude-sonnet-5-5', loginKind: 'subscription', state: 'idle', mini: 'idle', busy: false, branch: g.branch, runsOn: g.name, cost: 0.42, inTok: 12000, outTok: 3100 }))] }));
    for (const g of ghosts) {
      let i = 0;
      const tick = () => {
        const [state, ms] = g.steps[i % g.steps.length]!;
        this.updateAgent(g.id, () => ({ state, mini: stateToMini(state), busy: isBusyState(state) }));
        if (state === 'awaiting-approval') this.toast('warn', `${g.name}'s agent needs approval  ·  ${g.branch}`, 5000);
        i++; this.ghostTimers.push(setTimeout(tick, ms));
      };
      this.ghostTimers.push(setTimeout(tick, g.name === 'maya' ? 2500 : 4500));
    }
  }
}

export function errorTitle(code: string): string {
  switch (code) {
    case 'provider_not_installed': return 'Claude Code is not installed';
    case 'provider_not_signed_in': return 'Not signed in';
    case 'provider_cap_reached': return 'Usage limit reached';
    case 'provider_rate_limited': return 'The service is busy';
    case 'provider_version_unsupported': return 'This version is not supported';
    default: return 'Something went wrong';
  }
}
export function modeLabel(m: PermissionMode): string {
  return m === 'plan' ? 'Plan mode: read-only, nothing is changed' : m === 'acceptEdits' ? 'Accept edits: file edits go through, commands still ask' : m === 'bypassPermissions' ? 'Bypass: everything but dangerous commands is allowed' : 'Default: ask before edits and commands';
}
