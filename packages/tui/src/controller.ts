/**
 * AppController: owns the engine session, turns normalised engine events into transcript items and agent states,
 * answers approvals through the permission policy, runs slash commands, and drives the mascot.
 * The React tree only reads the store and calls the controller's methods.
 */
import { CLAUDE_MODELS, createAgentBus, createCheckpointManager, createContextView, modelLabel, newId, nodeGit } from '@centcom/agent';
import { createInterruptController, createModelRegistry, usageTable, type InterruptController, type ModelRegistry } from '@centcom/agent';
import type { AgentBus, AgentId, FleetManager, FleetNode, Ledger, Checkpoint, CheckpointManager, ContextConfig, ContextView, EngineId, EngineStartOptions, GitRunner, PermissionEngine, PolicyMode, RewindMode } from '@centcom/agent';
import type { PendingApproval as PolicyPending } from '@centcom/agent';
import type { Logger } from '@centcom/net';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionStore, ago, titleFrom, type SessionMeta } from './sessions.js';
import { PasteStore } from './prompt/paste.js';
import { animationEntries, commandEntries, createFileIndex, FIRST_LABELS, listProvider, quickEntries, type FileIndex, type PaletteProvider } from './palette/index.js';
import { errorGuide } from './errors.js';
import { copyToClipboard } from './util/clipboard.js';
import { newPick, pickAll, pickMove, pickResult, pickToggle, type PickOption } from './pick/model.js';
import { NightCycle, initialNight, counts as nightCounts, type NightState, type NightTask } from './night/index.js';
import { LIBRARY_DIR, MASTER_DIR, discover, injection, librarySkills, masterSkills, match, mergeLibrary, setEnabled, loadEntries, type Skill } from '@centcom/skills';
import { MascotDriver, bakedByCategory, bakedCategories, getBaked, type CentoColor } from '@centcom/mascot';
import type { AgentEngine, ApprovalDecision, ApprovalRequest, EngineQuestion, EngineSession, QuestionGate, NormalisedEvent, PermissionGate, PermissionMode } from '@centcom/agent';
import { Store } from './state/store.js';
import { initialSettings, isBusyState, stateToMini, type AgentView, type AppState, type Item, type Mode, type PendingApproval, type Settings } from './state/model.js';
import { COMMANDS } from './state/commands.js';
import { emptyText } from './onboarding/copy.js';
import { reduceTasks } from './tasks/model.js';
import { VerbRotator } from './util/verbs.js';

/** The longest message Centcom sends in one go. */
export const MAX_MESSAGE = 65_536;
export interface ControllerOptions {
  /** How long an approval waits before the engine declines it (shown as a countdown). */
  approvalTimeoutMs?: number;
  /** Where copied text goes (tests pass a recorder). Default: the system clipboard. */
  clipboard?: (text: string) => void;
  /** Mouse wheel on at start (default: when stdout is a terminal). */
  mouse?: boolean;
  engine: AgentEngine; demo: boolean; cwd: string; branch?: string; version: string; permissionMode?: PermissionMode;
  /** `code` is the process exit code to use (130 after a forced interrupt). */ onExit?: (code?: number) => void; ghosts?: boolean; settings?: Partial<Settings>; verbs?: VerbRotator;
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
  views?: Partial<Record<'mcp' | 'hooks' | 'memory' | 'doctor' | 'init', (args: string[]) => Promise<string[]>>>;
  /** Called with the main agent's events too (file locks between agents use it). */
  observers?: ((agentId: string, ev: NormalisedEvent) => void)[];
  /** Usage as the engines reported it (lane C029): `/usage`, budget warnings, the informational outbox. Its cost alerts arrive on `ledgerBus`. */
  ledger?: Ledger; ledgerBus?: AgentBus;
  /** Night cycle: where the queue is kept between runs and the morning reports go. Leave out to keep it in memory only. `gapMs` is the pause between tasks. */
  night?: { dir: string; gapMs?: number };
  /** Where the cached model lists live (small file; none = not cached). */ modelCache?: { read(p: string): Promise<string | undefined>; write(p: string, t: string): Promise<void> };
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
  private readonly me = 'agt_you';
  readonly night: NightCycle; private nightSending = false;
  private bus: AgentBus = createAgentBus({ onError: () => undefined });
  private ctxView?: ContextView; private cp?: CheckpointManager; private pendingReqs = new Map<string, ApprovalRequest>(); private lastEsc = 0;

  constructor(private o: ControllerOptions) {
    this.verbs = o.verbs ?? new VerbRotator();
    const settings = { ...initialSettings(), permissionMode: o.permissionMode ?? 'default', ...o.settings }; settings.mouse = o.mouse ?? (settings.mouse && !!process.stdout.isTTY); // the wheel only makes sense in a terminal
    const me: AgentView = { id: this.me, name: 'you', color: settings.color, mine: true, engine: o.engine.label, provider: o.engine.provider, model: '', loginKind: 'unknown', state: 'idle', mini: 'idle', busy: false, branch: o.branch ?? '', runsOn: 'you', cost: 0, inTok: 0, outTok: 0 };
    this.store = new Store<AppState>({
      items: [], agents: [me], activeAgent: this.me, mode: 'chat', input: '', cursor: 0, history: o.history ?? [], histIdx: null, draft: '', scroll: 0, toasts: [], approvals: [], settings,
      busy: false, verb: this.verbs.next(), limits: [], cwd: o.cwd, branch: o.branch ?? '', engineId: o.engine.id, engineLabel: o.engine.label, demo: o.demo, fleet: true, tasks: [], tasksOpen: true,
      slashSel: 0, palette: { query: '', sel: 0 }, modelSel: 0, gallery: { cat: 0, idx: 0, color: 0, query: '' }, version: o.version, sessionId: newId('ses'), sessions: [], night: initialNight(),
    });
    this.driver = new MascotDriver({ reducedMotion: settings.reducedMotion, color: settings.color });
    this.night = this.makeNight();
    const clock = { now: () => Date.now(), setTimeout: (f: () => void, ms: number) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, clearTimeout: (h: never) => clearTimeout(h as NodeJS.Timeout) };
    this.ctxView = createContextView({ bus: this.bus, clock, config: o.context, engines: { capabilities: () => o.engine.capabilities(), status: () => (this.state.busy ? 'running' : this.session ? 'waiting' : 'starting'), send: async (_id, prompt) => { await this.session?.send(prompt); } } });
    this.bus.on('agent:context_alert', (a) => { if (a.level === 'warn') this.notice('warn', `The context is ${Math.round(a.pct)}% full.`, 'Type /compact to have the agent compact it.'); else if (a.level === 'full') { this.notice('warn', 'The context is almost full.', 'Type /compact now, or start fresh with /new.'); this.driver.setState('context-full'); } });
    if (o.fleet) this.watchFleet(o.fleet);
    this.models = createModelRegistry({
      config: () => ({ model: this.state.settings.model || undefined }), bus: { emit: (_k, p) => this.o.logger?.debug('model.changed', { reason: p.reason }) },
      engines: { get: (id) => (id === this.o.engine.id ? this.o.engine : undefined) }, cachePath: 'models-cache.json', clock: { now: () => Date.now() },
      fs: { read: async (p) => this.o.modelCache?.read(p), write: async (p, t) => this.o.modelCache?.write(p, t) },
      notify: (level, text, detail) => { this.toast(level, text); if (detail) this.notice(level, text, detail); },
    });
    o.ledgerBus?.on('cost.alert', (a) => { if (a.session_id !== this.state.sessionId) return; this.notice(a.level === 'error' ? 'warn' : 'info', a.level === 'error' ? `This conversation has reached its cost budget (${a.pct}% of it, as the tools reported it).` : `This conversation is at ${a.pct}% of its cost budget (as the tools reported it).`, 'Budgets only warn: nothing was stopped. Change it with budget.session_usd in your settings.'); this.driver.setState('cost-alert'); });
    if (o.checkpoints) this.cp = createCheckpointManager({ worktree: o.cwd, agentId: this.me, git: o.checkpoints.git ?? nodeGit, clock,
      store: { markRewind: async (seq) => this.rewindTranscript(seq), summarize: async (seq, max) => this.summaryUpTo(seq, max) },
      engine: { capabilities: () => o.engine.capabilities(), start: (so) => o.engine.start({ ...this.startOptions(so.resume?.engine_session_id), ...so }) } });
  }

  get state() { return this.store.get(); }
  /** The display name of an agent ("you" for the main one). */
  agentName(id: string) { return this.state.agents.find((a) => a.id === id)?.name ?? 'an agent'; }
  private set(p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) { this.store.set((st) => { const q = typeof p === 'function' ? p(st) : p; return 'input' in q && !('anchor' in q) ? { ...q, anchor: undefined } : q; }); } // a new prompt text drops any selection
  /** UI-level state changes (input buffer, scroll, mode, overlay selections). */
  patch(p: Partial<AppState>) { this.store.set('input' in p && !('anchor' in p) ? { ...p, anchor: undefined } : p, 'input' in p || 'cursor' in p); }
  /** Copy to the clipboard and say so. */
  copy(text: string) { if (!text) return; (this.o.clipboard ?? ((t) => copyToClipboard(t)))(text); this.toast('ok', `Copied ${text.length} character${text.length === 1 ? '' : 's'}`, 1400); }
  private updateAgent(id: string, fn: (a: AgentView) => Partial<AgentView>) { this.set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, ...fn(a) } : a)) })); }
  private addItem(it: Item) { this.set((s) => ({ items: [...s.items, it] })); }
  private patchItem(pred: (i: Item) => boolean, fn: (i: Item) => Item) { this.set((s) => ({ items: s.items.map((i) => (pred(i) ? fn(i) : i)) })); }

  /* ------------------------------------------------------------------ lifecycle */
  async start() {
    this.driver.start();
    this.driver.setState('ready');
    let resumeToken: string | undefined; let carry: string | undefined;
    if (this.o.resume && this.o.sessions) {
      const id = this.o.resume === 'last' ? this.o.sessions.list(this.o.cwd, 1)[0]?.id : this.o.resume;
      const saved = id ? this.o.sessions.load(id) : undefined;
      if (saved) { this.loadSaved(saved.meta, saved.items); if (saved.meta.engine === this.o.engine.id) resumeToken = saved.meta.resumeToken; else carry = this.carryOver(saved.meta); }
      else this.notice('warn', this.o.resume === 'last' ? 'No saved conversation in this folder yet, so this is a new one.' : 'Could not find that saved conversation, so this is a new one.');
    }
    await this.startEngine(resumeToken, carry);
    if (this.o.ghosts) this.startGhosts();
    this.verbTimer = setInterval(() => { if (this.state.busy) this.set({ verb: this.verbs.next() }); }, 4200);
    this.verbTimer.unref?.();
    this.refreshSessions();
    // save shortly after anything changes, never on every streamed token
    this.store.subscribe(() => this.schedulePersist());
    let lastSettings = this.state.settings; let lastFleet = this.state.fleet;
    this.store.subscribe(() => { const s = this.state; if (s.settings !== lastSettings || s.fleet !== lastFleet) { lastSettings = s.settings; lastFleet = s.fleet; this.o.onPrefs?.({ settings: s.settings, fleet: s.fleet }); } });
  }

  private startOptions(resumeToken?: string, carry?: string): EngineStartOptions {
    const gate: PermissionGate = { decide: (r) => this.decide(r) };
    const questionGate: QuestionGate = { ask: (qs) => this.askEngine(qs) };
    return { agentId: this.me, cwd: this.o.cwd, permissionMode: this.state.settings.permissionMode, model: this.state.settings.model || undefined, addDirs: this.o.demo ? undefined : [MASTER_DIR, LIBRARY_DIR], approvalGate: gate, questionGate, ...(resumeToken ? { resume: { engine_session_id: resumeToken } } : {}), ...(carry ? { systemPromptAppend: carry } : {}) };
  }
  private async startEngine(resumeToken?: string, carry?: string) { this.adopt(await this.o.engine.start(this.startOptions(resumeToken, carry))); }
  /** A conversation saved with the other engine cannot be resumed by this one (its session id means nothing here): this one starts fresh with a summary of what was said. */
  private carryOver(meta: SessionMeta): string { const other = meta.engine === 'codex' ? 'Codex' : meta.engine === 'claude-code' ? 'Claude Code' : meta.engine; this.notice('info', `This conversation was with ${other}. ${this.o.engine.label} continues it from a summary of what was said.`); const n = this.state.items.filter((i) => i.kind === 'user').length; return `This conversation started with another coding agent. Summary of it so far:\n\n${this.summaryUpTo(n + 1, 8 * 1024)}`; }
  /** Make `s` the running engine session (after a start, or a conversation rewind). */
  private adopt(s: EngineSession) {
    this.session = s; if (this.effort) s.setEffort?.(this.effort);
    this.models.attach({ agentId: this.me, engine: this.o.engine.id, setModel: (m) => s.setModel?.(m) });
    const m = this.state.settings.model; if (m) s.setModel?.(m);
    void this.consume(s);
  }
  /** Which model the agent uses; a change made during a turn applies when the turn ends (lane C028). */
  readonly models: ModelRegistry;

  /* ------------------------------------------------------------------ saved conversations */
  private persistTimer?: NodeJS.Timeout; private lastItems?: Item[]; private lastToken?: string; private lastSid = '';
  private schedulePersist() {
    if (!this.o.sessions || this.persistTimer) return;
    this.persistTimer = setTimeout(() => { this.persistTimer = undefined; this.persist(); }, this.state.busy ? 1500 : 600); this.persistTimer.unref?.(); // while text streams, less often: a save rewrites the whole view
  }
  persist() {
    const st = this.o.sessions; const s = this.state; if (!st || !s.items.length) return;
    const first = s.items.find((i) => i.kind === 'user');
    const meta: SessionMeta = { id: s.sessionId, cwd: this.o.cwd, engine: this.o.engine.id, title: titleFrom(s.items), model: s.settings.model || undefined, resumeToken: this.session?.resumeToken(), createdAt: this.createdAt ?? (first && first.kind === 'user' ? first.ts : Date.now()), updatedAt: Date.now(), messages: s.items.filter((i) => i.kind === 'user').length, ...(s.tasks.length ? { tasks: s.tasks } : {}), tasksOpen: s.tasksOpen };
    this.createdAt = meta.createdAt;
    // items are replaced (never mutated) on every change, so identity tells us whether anything new needs saving
    if (s.items === this.lastItems && meta.resumeToken === this.lastToken && s.sessionId === this.lastSid && s.tasks === this.lastTasks && s.tasksOpen === this.lastTasksOpen) return;
    this.lastItems = s.items; this.lastTasks = s.tasks; this.lastTasksOpen = s.tasksOpen; this.lastToken = meta.resumeToken; this.lastSid = s.sessionId;
    try { st.save(meta, s.items); } catch (e) { this.toast('warn', 'Could not save this conversation: ' + String((e as Error).message ?? e)); }
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
    this.persist(); this.o.sessions?.close(this.state.sessionId); await this.dropSession();
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
    this.persist(); this.o.sessions?.close(this.state.sessionId); await this.dropSession();
    this.lastItems = undefined; this.set({ items: [], approvals: [] }); this.loadSaved(saved.meta, saved.items);
    if (saved.meta.engine === this.o.engine.id) await this.startEngine(saved.meta.resumeToken); else await this.startEngine(undefined, this.carryOver(saved.meta));
  }
  private async listSessions() {
    const list = this.o.sessions?.list(this.o.cwd, 10) ?? [];
    if (!list.length) { this.addItem({ kind: 'notice', id: nid('n'), level: 'info', text: emptyText('no-sessions') }); return; }
    const ago = (t: number) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
    const ids = await this.pick({ title: 'Continue a saved conversation', options: list.map((m) => ({ id: m.id, label: (m.id === this.state.sessionId ? '● ' : '') + m.title, hint: `${m.messages} msg · ${ago(m.updatedAt)}` })), checked: [this.state.sessionId], multi: false, confirm: 'resume' });
    if (ids?.[0] && ids[0] !== this.state.sessionId) await this.resumeSession(ids[0]);
  }

  stop() {
    this.stopped = true; this.persist(); this.o.sessions?.close(); void this.o.ledger?.flush().catch(() => undefined);
    this.driver.stop(); this.ghostTimers.forEach(clearTimeout); if (this.verbTimer) clearInterval(this.verbTimer);
    this.toastTimers.forEach(clearTimeout);
    for (const a of this.state.approvals) a.resolve({ decision: 'deny', scope: 'once', reason: 'exit' });
    void this.session?.stop();
    void this.stopFleet();
  }
  /** Fleet agents are this app's own processes: stop them before exiting (at most about 8 s). */
  stopFleet(): Promise<void> { return this.o.fleet ? this.o.fleet.manager.stopAll().catch(() => undefined) : Promise.resolve(); }

  private async consume(s: EngineSession) {
    for await (const ev of s.events) { if (s !== this.session) break; this.apply(ev); } // a replaced session's leftovers are not shown
    if (s === this.session && !this.stopped) this.sessionLost(s);
  }
  private stopped = false; private deadToken?: string;
  /** Stop the agent on purpose (a new conversation, a resume): it is detached first, so its closing stream is not mistaken for a crash. */
  private async dropSession() { const s = this.session; this.session = undefined; await s?.stop(); }
  /** The agent's event stream ended on its own (the process died without a word). Stop waiting, say so, and start it again on the next message. */
  private sessionLost(s: EngineSession) {
    this.deadToken = s.resumeToken?.() ?? this.deadToken; this.session = undefined; this.cancelQuestions();
    this.set((st) => ({ busy: false, turnStartedAt: undefined, items: st.items.map((i) => (i.kind === 'thinking' && !i.done ? { ...i, done: true, ms: Date.now() - i.ms } : i.kind === 'tool' && i.status === 'running' ? { ...i, status: 'error' as const } : i)) }));
    this.updateAgent(this.me, () => ({ busy: false })); this.setAgentState(this.me, 'error');
    this.addItem({ kind: 'notice', id: nid('n'), level: 'error', text: `${this.o.engine.label} stopped unexpectedly`, detail: 'Your conversation is safe. Send your next message and it starts again where it left off. If this keeps happening, run `centcom doctor`.' });
  }

  /* ------------------------------------------------------------------ events -> state */
  apply(ev: NormalisedEvent) {
    this.o.onEvent?.(ev);
    this.logEvent(ev);
    try { this.ctxView?.onEvent(ev); } catch { /* the meter never breaks the transcript */ }
    for (const ob of this.o.observers ?? []) { try { ob(this.me, ev); } catch { /* an observer never breaks the transcript */ } }
    this.account(this.me, ev, this.o.engine.id); this.models.onEvent(this.me, ev as never);
    if (ev.type === 'error' && /model/i.test(ev.tool_message)) this.models.onRejected(this.me, ev.tool_message);
    this.o.sessions?.append(this.state.sessionId, this.o.cwd, ev); // the conversation log (lane C026)
    if (ev.type === 'turn.done') void this.cp?.endTurn().catch(() => undefined);
    const me = this.me;
    switch (ev.type) {
      case 'session.started':
        this.updateAgent(me, () => ({ model: ev.model, loginKind: ev.login_kind, engine: this.o.engine.label }));
        break;
      case 'turn.started':
        this.currentTurn = ev.turn_id;
        this.set({ busy: true, turnStartedAt: Date.now(), verb: this.verbs.next() }); this.updateAgent(me, () => ({ busy: true })); break;
      case 'status': if (ev.state === 'awaiting-approval' && this.night.active()) break; /* the night answers by rule: nobody is being waited for */ this.setAgentState(me, ev.state); break;
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
      case 'question.asked': this.notice('info', ev.text, ev.options?.join('  ·  ')); if (ev.options?.length) void this.answerQuestion(ev.text, ev.options, ev.multi === true); break;
      case 'engine.warning': this.notice('warn', ev.text); break;
      case 'error':
        if (ev.retry) { this.toast('warn', `Retrying (${ev.retry.attempt}/${ev.retry.max_retries})…`); break; }
        { const g = errorGuide(ev.code, this.state.engineLabel); this.addItem({ kind: 'notice', id: nid('n'), level: 'error', text: g.title, detail: [g.help, ev.tool_message ? `Details: ${ev.tool_message}` : ''].filter(Boolean).join('\n') }); }
        this.night.noteError(ev.code, !!ev.fatal);
        break;
      case 'turn.done':
        this.set((s) => ({ busy: false, turnStartedAt: undefined, items: s.items.map((i) => (i.kind === 'thinking' && !i.done ? { ...i, done: true, ms: Date.now() - i.ms } : i.kind === 'tool' && i.status === 'running' && ev.outcome === 'canceled' ? { ...i, status: 'canceled' as const } : i)) }));
        this.updateAgent(me, () => ({ busy: false }));
        if (ev.outcome === 'canceled') { this.notice('warn', 'Interrupted.'); this.setAgentState(me, 'idle'); }
        this.night.turnDone(ev.outcome);
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
    if (r.agent_id === this.me && this.interrupts.cancelledTurn(this.currentTurn)) return Promise.resolve({ decision: 'deny', scope: 'once', reason: 'interrupt' }); // a late question from a stopped turn is never shown
    if (this.o.policy) return this.decideWithPolicy(r);
    if (this.night.active()) return Promise.resolve(this.nightAnswer(r));
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
    if (this.night.active()) return Promise.resolve(this.nightAnswer(req));
    return new Promise((resolve) => {
      const me = this.state.agents.find((a) => a.id === req.agent_id);
      const pending: PendingApproval = { req, agentName: me?.name ?? 'agent', color: me?.color ?? 'violet', resolve, confirmHigh: req.risk === 'high', expiresAt: Date.now() + (this.o.approvalTimeoutMs ?? 600_000) };
      signal.addEventListener('abort', () => { this.set((s) => ({ approvals: s.approvals.filter((a) => a !== pending) })); resolve({ decision: 'deny', scope: 'once', reason: 'cancelled' }); }, { once: true });
      this.set((s) => ({ approvals: [...s.approvals, pending] }));
    });
  }

  /** While the night cycle runs nobody is asked: the rule in `night/model.ts` decides, and the transcript shows what was refused. */
  private nightAnswer(r: ApprovalRequest): ApprovalDecision {
    const d = this.night.decide({ tool: r.tool, risk: r.risk, command: r.command });
    if (d.decision === 'deny') this.notice('info', `Night cycle refused: ${r.tool}${r.command ? ` \`${r.command.slice(0, 80)}\`` : r.path ? ` ${r.path}` : ''}`, d.reason);
    return { decision: d.decision, scope: 'once', ...(d.reason ? { reason: d.reason } : {}) };
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

  /** A typed answer to an engine's question: the next line you send is the answer, never a message to the agent and never kept in the transcript. */
  private pendingAnswer?: (text: string | undefined) => void;
  private askText(q: EngineQuestion): Promise<string | undefined> {
    this.addItem({ kind: 'notice', id: nid('n'), level: 'info', text: q.text, detail: q.secret ? 'Type your answer and press Enter. It is not kept in this conversation. Esc cancels.' : 'Type your answer and press Enter. Esc cancels.' });
    return new Promise((resolve) => { this.pendingAnswer = resolve; });
  }
  /** Codex asks mid-turn and waits for the reply: a list for choices (with a way to type your own), text otherwise. Undefined when you cancel. */
  private async askEngine(qs: EngineQuestion[]): Promise<Record<string, string[]> | undefined> {
    const out: Record<string, string[]> = {};
    if (this.night.active()) { for (const q of qs) out[q.id] = ['Decide for yourself: nobody is here to answer. Pick the most reasonable option and say what you assumed.']; return out; } // the night cycle never waits for a person
    for (const q of qs) {
      if (q.options?.length) {
        const OTHER = '\u0000other';
        const ids = await this.pick({ title: q.header ? `${q.header}: ${q.text}` : q.text, note: 'Esc cancels the question.', options: [...q.options.map((o, i) => ({ id: String(i), label: o.label, hint: o.description })), ...(q.allowOther ? [{ id: OTHER, label: 'Something else…' }] : [])], multi: false, confirm: 'answer' });
        if (!ids?.length) return undefined;
        if (ids[0] === OTHER) { const t = await this.askText(q); if (t === undefined) return undefined; out[q.id] = [t]; } else out[q.id] = [q.options[Number(ids[0])]!.label];
      } else { const t = await this.askText(q); if (t === undefined) return undefined; out[q.id] = [t]; }
    }
    return out;
  }
  /** Stop waiting on any open question (an interrupt, a new session). */
  private cancelQuestions() { const a = this.pendingAnswer; this.pendingAnswer = undefined; a?.(undefined); if (this.state.mode === 'pick') this.pickKey('cancel'); }

  /** A question waiting for y (memory notes, rewinds): the answer never goes to the engine or into history. */
  private pendingMemory?: { diff: string; apply: () => Promise<string>; no?: string };
  async submit(raw: string, opts: { wire?: string } = {}) {
    const text = raw.trim();
    if (!text) return;
    const expanded = this.pastes.expand(text);
    if (expanded.length > MAX_MESSAGE) { this.toast('warn', `That message is ${expanded.length.toLocaleString('en-US')} characters; the limit is ${MAX_MESSAGE.toLocaleString('en-US')}. Shorten it, or put the long part in a file and mention the path.`, 7000); return; } // your text stays in the prompt
    if (this.state.mode === 'night' && !this.nightSending && !text.startsWith('/')) { this.nightAdd(text); return; } // in the night panel, a message is a task
    if (this.night.active() && !this.nightSending && !text.startsWith('/')) { this.toast('warn', 'Night cycle is running. Add tasks with /night add …, stop it with /night stop.'); return; }
    if (this.pendingAnswer) { const a = this.pendingAnswer; this.pendingAnswer = undefined; this.set({ input: '', cursor: 0 }); a(text); return; }
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
    this.addItem({ kind: 'user', id: nid('u'), text, ts: Date.now() }); this.o.sessions?.noteUser(this.state.sessionId, this.o.cwd, text);
    this.setAgentState(this.me, 'prompt-received');
    let outgoing = opts.wire ?? expanded; // the transcript keeps what the person typed; night tasks carry their rules on the wire only
    if (this.state.settings.autoSkills) {
      const picks = match(opts.wire ? text.replace(/^\[night \d+\/\d+\]\s*/, '') : text, this.skills());
      if (picks.length) {
        this.addItem({ kind: 'notice', id: nid('n'), level: 'info', text: 'auto skills: ' + picks.map((p) => (p.skill.kind === 'command' ? '/' : '') + p.skill.name).join(' · '), detail: picks.map((p) => `${p.skill.name}: matched ${p.why.join(', ')}`).join('\n') });
        if (!this.o.demo) outgoing = injection(picks) + (opts.wire ?? expanded);
      }
    }
    await this.checkpointBefore(text);
    this.pastes.clear(); // the chips are spent
    if (!this.session && !this.stopped) { try { await this.startEngine(this.deadToken); this.deadToken = undefined; } catch (e) { this.addItem({ kind: 'notice', id: nid('n'), level: 'error', text: `Could not start ${this.o.engine.label} again`, detail: String((e as Error).message ?? e) }); this.set({ busy: false }); return; } }
    try { await this.session?.send(outgoing); } catch (e) { this.addItem({ kind: 'notice', id: nid('n'), level: 'error', text: 'Could not send the prompt', detail: String(e) }); }
  }

  /** Reasoning effort for the next turns, if the engine has the setting (Codex). Returns false when it does not. */
  setEffort(effort: string): boolean { if (!this.session?.setEffort) return false; this.session.setEffort(effort); this.effort = effort; this.toast('ok', `Reasoning effort: ${effort || 'default'}`); return true; }
  private effort = '';
  /** The levels the running engine accepts: Claude Code's fixed list, or the current Codex model's own. */
  private async effortLevels(): Promise<string[]> {
    if (this.state.engineId === 'claude-code') return ['low', 'medium', 'high', 'xhigh', 'max'];
    return (await this.engineModels()).find((m) => m.id === this.state.settings.model)?.efforts ?? ['low', 'medium', 'high'];
  }
  private async effortCommand(arg: string) {
    if (!this.session?.setEffort) { this.toast('warn', 'This engine has no effort setting.'); return; }
    const levels = await this.effortLevels(); const want = arg.trim().toLowerCase();
    if (want === 'default' || want === 'off' || want === 'auto') { this.setEffort(''); return; }
    if (want) { if (levels.includes(want)) this.setEffort(want); else this.toast('warn', `Effort is one of: ${levels.join(', ')} (or default).`); return; }
    const ids = await this.pick({ title: 'Reasoning effort', note: 'Higher thinks longer and costs more', options: [{ id: '', label: 'default', hint: "the engine's own choice" }, ...levels.map((l) => ({ id: l, label: l }))], checked: [this.effort], multi: false, confirm: 'use' });
    if (ids) this.setEffort(ids[0] ?? '');
  }
  /** The models this engine's account offers, when the engine can list them (Codex). Empty otherwise. */
  async engineModels(): Promise<import('@centcom/agent').ModelChoice[]> { const l = (this.session as { listModels?: () => Promise<import('@centcom/agent').ModelChoice[]> } | undefined)?.listModels; try { return l ? await l.call(this.session) : []; } catch { return []; } }
  /** Switch model for the next turn (the running turn keeps its model). */
  setModel(id: string) {
    this.setSettings({ model: id }); void this.models.switchTo(this.me, id, 'user').then((c) => { if (c.note?.startsWith('Already')) this.toast('info', c.note); });
    this.updateAgent(this.me, () => ({ model: id || 'default' }));
    this.toast('ok', `Model: ${id ? modelLabel(id) : 'Default'}${this.state.busy ? ' (from the next message)' : ''}`);
  }

  private skillCache?: Skill[];
  /** Your own skills first; bundled ones fill in, skipping any you already have under the same name. */
  private loadSkills(): Skill[] {
    const own = discover({ cwd: this.o.cwd }); const have = new Set(own.map((k) => k.name.toLowerCase()));
    return mergeLibrary([...own, ...masterSkills().filter((k) => !have.has(k.name.split('--').slice(1).join('--').toLowerCase()))], librarySkills());
  }
  skills(): Skill[] { return (this.skillCache ??= this.o.skills ?? this.loadSkills()); }

  /* ------------------------------------------------------------------ interrupt (lane C030) */
  private currentTurn?: string;
  /** One way to stop the agent, whatever the engine: its open approvals are denied, its processes stopped by the signal ladder, the partial answer kept and marked. */
  readonly interrupts: InterruptController = createInterruptController({
    targets: { get: (id) => (id === this.me ? { busy: () => this.state.busy, turnId: () => this.currentTurn, interrupt: (o) => (this.session ? this.session.interrupt(o) : Promise.resolve({ stopped: false })) } : undefined), busyIds: () => (this.state.busy ? [this.me] : []) },
    approvals: { cancel: () => { const open = this.state.approvals; for (const a of open) a.resolve({ decision: 'deny', scope: 'once', reason: 'interrupt' }); if (open.length) this.set({ approvals: [] }); return open.length; } },
    states: { interrupted: () => { this.set((s) => ({ busy: false, turnStartedAt: undefined, items: s.items.map((i) => (i.kind === 'assistant' && !i.done && i.agentId === this.me ? { ...i, done: true, interrupted: true } : i)) })); this.updateAgent(this.me, () => ({ busy: false })); this.setAgentState(this.me, 'idle'); } },
    emit: (e) => this.o.logger?.info('agent.interrupted', { reason: e.reason, hard: e.hard, method: e.method }),
  });
  /** True when the latest turn was stopped by an interrupt. */
  turnInterrupted(): boolean { return this.interrupts.cancelledTurn(this.currentTurn); }
  async interrupt(hard = false) { this.cancelQuestions(); if (!this.state.busy) return; await this.interrupts.interrupt(this.me, { mode: hard ? 'hard' : 'soft', reason: 'user' }); }

  /** Leave the app (the `app.quit` action). */
  quit(code = 0) { void this.o.ledger?.flush().catch(() => undefined); this.o.onExit?.(code); }
  /** ctrl+c: during a turn, the first stops it and a second within 1 s stops it hard and exits 130; idle, press twice within 2 s to quit. */
  ctrlC() {
    const r = this.interrupts.ctrlC();
    if (r === 'interrupted') this.toast('info', 'Stopping. Press ctrl+c again to force it and quit.');
    else if (r === 'hard') this.quit(130);
    else if (r === 'hint') this.toast('info', 'Press ctrl+c again to exit');
    else this.quit(0);
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

  /* ------------------------------------------------------------------ night cycle */
  private makeNight(): NightCycle {
    const dir = this.o.night?.dir; const file = dir ? join(dir, 'queue.json') : undefined;
    const cycle = new NightCycle({
      get: () => this.state.night, set: (p) => this.set((s) => ({ night: { ...s.night, ...(typeof p === 'function' ? p(s.night) : p) } })),
      submit: async (shown, wire) => { this.nightSending = true; try { await this.submit(shown, { wire }); } finally { this.nightSending = false; } },
      interrupt: () => this.interrupt(), lastAssistantText: () => { for (let i = this.state.items.length - 1; i >= 0; i--) { const it = this.state.items[i]!; if (it.kind === 'assistant' && it.text.trim()) return it.text; } return ''; },
      notice: (l, t, d) => this.notice(l, t, d), now: () => Date.now(), id: () => nid('nt'),
      setTimer: (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
      saved: () => { if (!file) return; try { mkdirSync(dir!, { recursive: true, mode: 0o700 }); const n = this.state.night; writeFileSync(file, JSON.stringify({ taskTimeoutMin: n.taskTimeoutMin, allowPush: n.allowPush, tasks: n.tasks.filter((t) => t.status === 'queued' || t.status === 'running').map((t) => t.text) })); } catch { /* the queue is a convenience; a full disk must not stop the night */ } },
      writeReport: (name, text) => { if (!dir) return undefined; try { mkdirSync(dir, { recursive: true, mode: 0o700 }); const p = join(dir, name); writeFileSync(p, text); return p; } catch { return undefined; } },
    }, { gapMs: this.o.night?.gapMs, branch: () => this.state.branch });
    if (file) { try { const q = JSON.parse(readFileSync(file, 'utf8')) as { taskTimeoutMin?: number; allowPush?: boolean; tasks?: string[] }; if (q.allowPush === true) this.set((s) => ({ night: { ...s.night, allowPush: true } })); const tasks = (q.tasks ?? []).filter((t) => typeof t === 'string').slice(0, 200); if (tasks.length) { this.set((s) => ({ night: { ...s.night, taskTimeoutMin: Math.max(1, Math.min(480, Number(q.taskTimeoutMin) || s.night.taskTimeoutMin)), tasks: tasks.map((text): NightTask => ({ id: nid('nt'), text, status: 'queued', approved: 0, denied: 0 })) } })); } } catch { /* no queue yet */ } }
    return cycle;
  }
  /** Tasks from the panel's prompt or `/night add`. */
  nightAdd(text: string) { const n = this.night.add(text); if (!n) { this.toast('warn', 'Nothing to add.'); return; } this.toast('ok', `Queued: ${this.state.night.tasks.length} in all`, 1600); }
  openNight() { this.night.arm(true); this.patch({ mode: 'night', input: '', cursor: 0, scroll: 0 }); }
  closeNight() { this.patch({ mode: 'chat' }); }
  nightStart() { const r = this.night.start(); if (!r.ok) this.toast('warn', r.why!); }
  /* ------------------------------------------------------------------ multi-select */
  private pickDone?: (ids: string[] | undefined) => void; private pickBack: Mode = 'chat';
  /** Open the picker and wait: the ticked ids, or undefined when cancelled. */
  pick(o: { title: string; note?: string; options: PickOption[]; checked?: string[]; multi?: boolean; confirm?: string }): Promise<string[] | undefined> {
    this.pickDone?.(undefined);
    return new Promise((resolve) => {
      this.pickBack = this.state.mode === 'night' ? 'night' : 'chat'; this.pickDone = resolve;
      this.set({ mode: 'pick', pick: newPick(o) });
    });
  }
  /* ------------------------------------------------------------------ settings screen */
  /** `/settings`: every setting and what it is now; choose one to change it, then you are back here. Esc leaves. */
  private async settingsMenu() {
    for (;;) {
      const st = this.state.settings; const ch = this.choices(); const val = (k: string) => ch[k]?.options.find((o) => o.id === ch[k]!.current)?.id ?? ch[k]?.current ?? '';
      const rows: { id: string; label: string; value: string; hint?: string }[] = [
        { id: 'mode', label: 'Permissions', value: val('mode'), hint: 'when the agent asks' }, { id: 'model', label: 'Model', value: st.model || 'default' }, { id: 'effort', label: 'Effort', value: this.effort || 'default', hint: 'how hard it thinks' },
        { id: 'theme', label: 'Theme', value: st.theme }, { id: 'mascot', label: 'Cento size', value: st.mascot }, { id: 'color', label: "Cento's colour", value: st.color }, { id: 'motion', label: 'Animation', value: st.reducedMotion ? 'reduced' : 'full' },
        { id: 'spinner', label: 'Waiting line', value: st.spinner }, { id: 'density', label: 'Spacing', value: st.density }, { id: 'mouse', label: 'Mouse', value: st.mouse ? 'on' : 'off', hint: 'wheel and clicks' }, { id: 'auto', label: 'Auto skills', value: st.autoSkills ? 'on' : 'off' },
      ];
      const ids = await this.pick({ title: 'Settings', note: 'Choose one to change it. Esc closes.', options: rows.map((r) => ({ id: r.id, label: `${r.label}: ${r.value}`, hint: r.hint })), multi: false, confirm: 'change' });
      const id = ids?.[0]; if (!id) return;
      if (id === 'mouse') { await this.runCommand(`/mouse ${st.mouse ? 'off' : 'on'}`); continue; }
      if (id === 'auto') { await this.runCommand(`/auto ${st.autoSkills ? 'off' : 'on'}`); continue; }
      await this.runCommand('/' + id); if (this.state.mode !== 'chat') return; // /model opens its own screen
    }
  }

  /* ------------------------------------------------------------------ command palette */
  private fileIndex?: FileIndex;
  /** Put text at the end of the prompt (a file mention, a skill hint). */
  insertIntoPrompt(t: string) { const input = this.state.input; const sep = input && !/\s$/.test(input) ? ' ' : ''; const next = input + sep + t; this.patch({ input: next, cursor: next.length }); }
  /** Run a command line from the palette. Commands that cannot do anything without a value are filled in for you to finish. */
  async runPaletteCommand(cmd: string) { if (cmd === '/trust') { this.patch({ input: '/trust rules', cursor: 12 }); return; } await this.submit(cmd); }
  /** What ctrl+k searches: commands, the quick settings and animations, files of this project, saved conversations and skills. */
  paletteProviders(): PaletteProvider[] {
    const run = (cmd: string) => () => this.runPaletteCommand(cmd); const item = (e: { id: string; label: string; detail: string; cmd: string }) => ({ id: e.id, label: e.label, detail: e.detail, run: run(e.cmd) });
    this.fileIndex ??= createFileIndex({ cwd: this.o.cwd, onPick: (p) => this.insertIntoPrompt('@' + p + ' ') });
    const files = this.fileIndex; const cmds = commandEntries(); const quick = quickEntries(); const anims = animationEntries();
    return [
      { ...listProvider('commands', 'Commands', () => [...cmds, ...quick, ...anims].map(item), { max: 8, recent: () => FIRST_LABELS }) },
      { id: 'files', group: 'Files', search: (q, signal) => files.search(q, signal) },
      listProvider('sessions', 'Sessions', () => (this.o.sessions?.list(this.o.cwd, 30) ?? []).filter((m) => m.id !== this.state.sessionId).map((m) => ({ id: 's:' + m.id, label: m.title, detail: `${m.messages} msg`, run: () => this.resumeSession(m.id) })), { max: 5, recent: () => (this.o.sessions?.list(this.o.cwd, 3) ?? []).filter((m) => m.id !== this.state.sessionId).map((m) => m.title) }),
      listProvider('skills', 'Skills', () => this.skills().map((k) => ({ id: 'k:' + k.name, label: k.name, detail: k.description.replace(/\s+/g, ' ').slice(0, 80), run: () => this.insertIntoPrompt(k.kind === 'command' ? `/${k.name} ` : `Use the ${k.name} skill: `) })), { max: 5 }),
    ];
  }

  /** Big pastes sit in the prompt as a short chip and are put back when the message is sent. */
  readonly pastes = new PasteStore();
  /** Watch every event of the main agent (the plain-text mode prints them). */
  addObserver(fn: (agentId: string, ev: NormalisedEvent) => void) { (this.o.observers ??= []).push(fn); }
  /** Answer the open list without keys: the ticked option numbers (1-based), or undefined to cancel. A one-of list takes the first. */
  pickAnswer(numbers: number[] | undefined) {
    const p = this.state.pick; if (!p) return;
    if (!numbers) { this.pickKey('cancel'); return; }
    const ids = numbers.filter((n) => n >= 1 && n <= p.options.length).map((n) => p.options[n - 1]!.id);
    this.set({ pick: { ...p, checked: p.multi ? ids : ids.slice(0, 1), sel: Math.max(0, p.options.findIndex((o) => o.id === ids[0])) } }); this.pickKey('enter');
  }
  /** A click on option `i`: a list of several toggles it; a one-of list picks it. */
  pickClick(i: number) {
    const p = this.state.pick; if (!p || i < 0 || i >= p.options.length) return;
    this.set({ pick: { ...p, sel: i } }); this.pickKey(p.multi ? 'toggle' : 'enter');
  }
  pickKey(k: 'up' | 'down' | 'toggle' | 'all' | 'enter' | 'cancel') {
    const p = this.state.pick; if (!p) return;
    if (k === 'up' || k === 'down') this.set({ pick: pickMove(p, k === 'up' ? -1 : 1) });
    else if (k === 'toggle') this.set({ pick: pickToggle(p) });
    else if (k === 'all') this.set({ pick: pickAll(p) });
    else { const done = this.pickDone; this.pickDone = undefined; this.set({ mode: this.pickBack, pick: undefined }); done?.(k === 'enter' ? pickResult(p) : undefined); }
  }
  /** The agent asked with options: tick one or more and your choice goes back as your next message (Esc to type your own). */
  private async answerQuestion(text: string, options: string[], multi = true) {
    if (this.night.active() || this.state.approvals.length) return;
    const ids = await this.pick({ title: text, note: multi ? 'Pick one or more. Esc to type your own answer.' : 'Esc to type your own answer.', options: options.map((o, i) => ({ id: String(i), label: o })), multi, confirm: 'send' });
    if (ids?.length) await this.submit(ids.map((i) => options[Number(i)]).join(', '));
  }
  /** `/night remove` with no number: tick the queued tasks to take out. */
  private async nightPickRemove() {
    const tasks = this.state.night.tasks.filter((t) => t.status !== 'running');
    if (!tasks.length) { this.toast('info', 'The queue is empty.'); return; }
    const ids = await this.pick({ title: 'Remove tasks from the night queue', options: tasks.map((t) => ({ id: t.id, label: t.text.split('\n')[0]!, hint: t.status })), confirm: 'remove' });
    if (!ids?.length) return;
    let n = 0; for (const id of ids) { const i = this.state.night.tasks.findIndex((t) => t.id === id); if (i >= 0 && this.night.remove(i + 1)) n++; }
    this.toast('ok', `Removed ${n} task${n === 1 ? '' : 's'}.`);
  }
  /** `/skills` with no argument: tick the bundled skills Centcom may auto-apply. */
  private async skillsPick() {
    const entries = loadEntries().filter((e) => e.status === 'ok' || e.status === 'quarantined');
    if (!entries.length) { this.toast('info', 'No bundled skills are installed. Run the skills sync first.'); return; }
    const was = entries.filter((e) => e.enabled).map((e) => e.id);
    const ids = await this.pick({ title: 'Skills Centcom may apply automatically', note: 'Tick the ones to keep on', options: entries.map((e) => ({ id: e.id, label: e.skill, hint: e.description })), checked: was, confirm: 'save' });
    if (!ids) return;
    let changed = 0; for (const e of entries) { const on = ids.includes(e.id); if (on !== was.includes(e.id)) { setEnabled(e.id, on); changed++; } }
    this.skillCache = undefined; this.toast('ok', changed ? `Updated ${changed} skill${changed === 1 ? '' : 's'}.` : 'No changes.');
  }

  private async nightCommand(arg: string) {
    const m = /^(\S*)[ \t]*([\s\S]*)$/.exec(arg.trim())!; const sub = m[1]!; const tail = m[2]!.trim(); const n = this.state.night; // the text after the word keeps its line breaks: one task per line
    switch (sub.toLowerCase()) {
      case '': case 'on': if (this.state.mode === 'night' && sub === '') this.closeNight(); else this.openNight(); break;
      case 'off': await this.night.stop('you turned it off'); this.night.arm(false); this.closeNight(); break;
      case 'start': case 'go': this.nightStart(); break;
      case 'stop': await this.night.stop(); this.toast('info', 'Night cycle stopped.'); break;
      case 'add': if (!tail) { this.openNight(); break; } this.nightAdd(tail); break;
      case 'remove': case 'rm': if (!tail) { await this.nightPickRemove(); break; } if (!this.night.remove(Number(tail))) this.toast('warn', `No removable task ${tail || ''}.`); break;
      case 'clear': this.night.clear(); this.toast('info', 'Queue cleared.'); break;
      case 'allow': { if (!tail) { const ids = await this.pick({ title: 'What may the night cycle do?', options: [{ id: 'none', label: 'Nothing leaves this machine', hint: 'no pushes' }, { id: 'push', label: 'Push work branches and open pull requests', hint: 'never main, never force, never merge' }], checked: [n.allowPush ? 'push' : 'none'], multi: false, confirm: 'use' }); if (ids?.[0]) await this.nightCommand('allow ' + ids[0]); break; } const w = tail.toLowerCase(); if (w === 'push') { this.night.setAllowPush(true); this.toast('ok', 'Night cycle may push work branches and open pull requests (never main, never force, never merge).', 5000); } else if (w === 'none' || w === 'nothing') { this.night.setAllowPush(false); this.toast('ok', 'Night cycle pushes nothing.'); } else this.toast('info', n.allowPush ? 'Allowed: pushing work branches and opening pull requests.' : 'Allowed: nothing leaves the machine. /night allow push to let it push work branches and open PRs.', 5000); break; }
      case 'timeout': { const m = Number(tail); if (!Number.isFinite(m) || m < 1) { this.toast('warn', `Per-task limit is ${n.taskTimeoutMin} minutes. Use /night timeout <minutes>.`); break; } this.night.setTimeoutMin(m); this.toast('ok', `Per-task limit: ${this.state.night.taskTimeoutMin} minutes.`); break; }
      case 'list': { const c = nightCounts(n); this.notice('info', `Night cycle: ${c.total} tasks (${c.done} done, ${c.failed} failed, ${c.queued} queued)`, n.tasks.map((t, i) => `${i + 1}. [${t.status}] ${t.text.split('\n')[0]!.slice(0, 90)}`).join('\n') || 'The queue is empty.'); break; }
      case 'report': this.notice('info', n.reportPath ? `Last report: ${n.reportPath}` : 'No report yet. One is written when a night cycle ends.'); break;
      default: this.toast('warn', `Unknown /night option "${sub}". Try on, start, stop, add, list, remove, clear, allow, timeout, report.`);
    }
  }

  /** The settings that are a pick from a short list: shown as a list when the command has no value. */
  private choices(): Record<string, { title: string; current: string; options: PickOption[] }> {
    const st = this.state.settings; const o = (...a: [string, string?][]): PickOption[] => a.map(([id, hint]) => ({ id, label: id, hint }));
    return {
      mode: { title: 'Permissions', current: ({ default: 'ask', acceptEdits: 'edits', plan: 'plan', bypassPermissions: 'bypass' } as Record<string, string>)[st.permissionMode] ?? 'ask', options: o(['ask', 'ask before commands and edits'], ['edits', 'edits go through, commands ask'], ['plan', 'read-only, nothing is changed'], ['bypass', 'dangerously skip all permission prompts']) },
      theme: { title: 'Theme', current: st.theme, options: o(['dark', 'Graphite'], ['light', 'Paper, for light terminals'], ['hc', 'high contrast: black, white, bold borders']) },
      mascot: { title: 'Cento size', current: st.mascot, options: o(['auto', 'by window height'], ['large'], ['small'], ['off']) },
      color: { title: "Cento's colour", current: st.color, options: o(['violet'], ['red'], ['yellow'], ['green'], ['brown']) },
      density: { title: 'Space between messages', current: st.density, options: o(['comfortable', 'a blank row between messages'], ['compact', 'fits more on screen']) },
      spinner: { title: 'While the agent works', current: st.spinner, options: o(['fun', 'rotating verbs'], ['plain', 'just "Working…"']) },
      motion: { title: 'Animation', current: st.reducedMotion ? 'reduced' : 'full', options: o(['full', 'Cento moves'], ['reduced', 'still, quieter']) },
    };
  }

  async runCommand(line: string) {
    const [cmd, ...rest] = line.slice(1).trim().split(/\s+/); const arg = rest.join(' ');
    const known = COMMANDS.find((c) => c.name === cmd);
    if (!known) { this.toast('warn', `Unknown command /${cmd}. Type / to see the list.`); return; }
    if (!arg && cmd! in this.choices()) { // a setting with no value: choose from a list instead of remembering the words
      const c = this.choices()[cmd!]!; const ids = await this.pick({ title: c.title, options: c.options, checked: [c.current], multi: false, confirm: 'use' });
      if (ids?.[0]) await this.runCommand(`/${cmd} ${ids[0]}`); return;
    }
    switch (cmd) {
      case 'help': this.set({ mode: 'help' }); break;
      case 'clear': case 'new': await this.newSession(); break;
      case 'resume': if (arg) await this.resumeSession(arg); else await this.listSessions(); break;
      case 'agents': this.set((s) => ({ fleet: !s.fleet })); break;
      case 'quit': this.o.onExit?.(); break;
      case 'night': await this.nightCommand(line.replace(/^\/night\b[ \t]*/, '')); break;
      case 'interrupt': await this.interrupt(); break;
      case 'rewind': await this.rewindCommand(arg); break;
      case 'compact': await this.compactCommand(); break;
      case 'fleet': await this.fleetCommand(arg); break;
      case 'usage': this.usageCommand(); break;
      case 'mcp': case 'hooks': case 'memory': case 'doctor': case 'init': {
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
      case 'theme': if (arg === 'dark' || arg === 'light' || arg === 'hc') this.setSettings({ theme: arg }); else this.toast('info', 'Try /theme dark, /theme light or /theme hc (high contrast)'); break;
      case 'density': if (arg === 'comfortable' || arg === 'compact') { this.setSettings({ density: arg }); this.toast('info', arg === 'compact' ? 'Compact: fewer blank rows' : 'Comfortable: a blank row between messages'); } else this.toast('info', 'Try /density comfortable or /density compact'); break;
      case 'spinner': if (arg === 'fun' || arg === 'plain') { this.setSettings({ spinner: arg }); this.toast('info', arg === 'plain' ? 'The waiting line says Working…' : 'The waiting line rotates its verbs'); } else this.toast('info', 'Try /spinner fun or /spinner plain'); break;
      case 'mouse': { const on = arg ? arg === 'on' : !this.state.settings.mouse; this.setSettings({ mouse: on }); this.toast('info', on ? 'Mouse wheel scrolls. /mouse off lets you select text with the mouse.' : 'Mouse off: select text with the mouse as usual.'); break; }
      case 'settings': await this.settingsMenu(); break;
      case 'effort': await this.effortCommand(arg); break;
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
        if (!arg) { await this.skillsPick(); break; }
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

  /* ------------------------------------------------------------------ usage (lane C029) */
  private engineSession = new Map<string, string>();
  /** Feeds the ledger: Claude Code reports cost as a running total for its session and tokens per turn; Codex reports per turn. */
  private account(agentId: string, ev: NormalisedEvent, engine: string) {
    const l = this.o.ledger; if (!l) return;
    try {
      if (ev.type === 'session.started') this.engineSession.set(agentId, ev.engine_session_id);
      else if (ev.type === 'usage.report') l.onUsageReport({ agentId, engine: engine as EngineId, engineSessionId: this.engineSession.get(agentId) ?? 'unknown', sessionId: agentId === this.me ? this.state.sessionId : undefined, cumulative: false, costCumulative: engine === 'claude-code', tokensIn: ev.input_tokens, tokensOut: ev.output_tokens, cacheRead: ev.cache_read_tokens, costUsd: ev.cost_usd });
      else if (ev.type === 'status') l.onAgentState(agentId, ev.state, new Date());
      else if (ev.type === 'turn.done') l.onAgentState(agentId, 'idle', new Date());
      else if (ev.type === 'error' && (ev.code === 'provider_cap_reached' || ev.code === 'provider_rate_limited')) l.onLimitEvent(agentId);
    } catch { /* the ledger never breaks the transcript */ }
  }
  private usageCommand() {
    const l = this.o.ledger; if (!l) { this.toast('info', 'Usage is not recorded in this session.'); return; }
    const rows = [{ label: 'this conversation', t: l.snapshot({ sessionId: this.state.sessionId }) }, ...this.fleetIds.filter(Boolean).map((id, i) => ({ label: `agent ${i + 1}`, t: l.snapshot({ agentId: id }) })), { label: 'all of today', t: l.snapshot({ day: l.byDay(1)[0]!.day }) }];
    this.notice('info', 'Usage as the tools reported it', usageTable(rows, l.byDay(7).slice(1).filter((d) => d.tokensIn || d.tokensOut || d.agentMs)).join('\n'));
  }

  /* ------------------------------------------------------------------ fleet */
  private fleetIds: string[] = [];
  private watchFleet(f: NonNullable<ControllerOptions['fleet']>) {
    f.bus.on('fleet:node', ({ node }) => { if (node.kind === 'agent') this.upsertFleetAgent(node); });
    f.bus.on('agent:event', ({ agent_id, event: ev }) => {
      if (!this.fleetIds.includes(agent_id)) return;
      this.account(agent_id, ev, this.o.engine.id);
      if (ev.type === 'status') this.updateAgent(agent_id, () => ({ state: ev.state, mini: stateToMini(ev.state), busy: isBusyState(ev.state) }));
      else if (ev.type === 'session.started') this.updateAgent(agent_id, () => ({ model: ev.model, loginKind: ev.login_kind }));
      else if (ev.type === 'usage.report') this.updateAgent(agent_id, () => ({ cost: ev.cost_usd ?? 0, inTok: ev.input_tokens, outTok: ev.output_tokens })); /* the engines report the session's running totals, the same as for the main agent */
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
  /** Bare `/fleet`: what you can do with parallel agents, as a list. Starting asks how many and what for. */
  private async fleetMenu() {
    const f = this.o.fleet!; const nodes = f.manager.list().filter((n) => n.kind === 'agent'); const has = nodes.length > 0;
    const ids = await this.pick({ title: 'Parallel agents', note: has ? `${nodes.length} agent${nodes.length === 1 ? '' : 's'} so far. Each works in its own folder and branch.` : 'None yet. Each one works in its own folder and branch.', multi: false, confirm: 'choose', options: [
      { id: 'start', label: 'Start agents…', hint: 'the same task, in parallel' },
      ...(has ? [{ id: 'list', label: 'Show them', hint: 'branch and state of each' }, { id: 'preview', label: 'What would merging one change?', hint: 'checks for conflicts' }, { id: 'stop', label: 'Stop agents…' }, { id: 'remove', label: 'Remove agents and their branches…' }] : []),
      { id: 'clean', label: 'Clean up leftovers', hint: 'folders of agents that were interrupted' }] });
    switch (ids?.[0]) {
      case 'start': {
        const n = await this.pick({ title: 'How many agents?', options: [1, 2, 3, 4, 6, 8].map((k) => ({ id: String(k), label: String(k), hint: k === 1 ? 'one on its own branch' : undefined })), multi: false, confirm: 'next' }); if (!n?.[0]) return;
        const task = await this.askText({ id: 'task', text: `What should ${n[0] === '1' ? 'it' : 'they'} work on?${n[0] === '1' ? '' : ' Every agent gets the same task.'}` }); if (!task?.trim()) return;
        await this.fleetCommand(`start ${n[0]} ${task.trim()}`); break;
      }
      case 'preview': {
        const pickedAgent = await this.pick({ title: 'Which agent?', options: nodes.map((x) => ({ id: x.id, label: `${this.fleetIds.indexOf(x.id) + 1}. ${x.branch ?? x.id}` })), multi: false, confirm: 'check' }); if (!pickedAgent?.[0]) return;
        await this.fleetCommand(`preview ${this.fleetIds.indexOf(pickedAgent[0]) + 1}`); break;
      }
      case 'stop': await this.fleetPick('stop'); break;
      case 'remove': await this.fleetPick('remove'); break;
      case 'list': await this.fleetCommand('list'); break;
      case 'clean': await this.fleetCommand('clean'); break;
      default: break;
    }
  }
  /** `/fleet stop` or `/fleet remove` with no number: tick the agents. */
  private async fleetPick(verb: 'stop' | 'remove') {
    const f = this.o.fleet!; const nodes = f.manager.list().filter((n) => n.kind === 'agent');
    if (!nodes.length) { this.toast('info', 'No fleet agents yet.'); return; }
    const ids = await this.pick({ title: `${verb === 'stop' ? 'Stop' : 'Remove'} fleet agents`, options: nodes.map((n) => ({ id: n.id, label: `${this.fleetIds.indexOf(n.id) + 1}. ${n.branch ?? n.id}`, hint: String((n as { state?: string }).state ?? '') })), confirm: verb });
    if (!ids?.length) return;
    for (const id of ids) { if (verb === 'stop') await f.manager.stop(id as AgentId); else { await f.manager.remove(id as AgentId, {}); this.fleetIds = this.fleetIds.map((x) => (x === id ? '' : x)); this.set((s) => ({ agents: s.agents.filter((a) => a.id !== id) })); } }
    this.toast('ok', `${verb === 'stop' ? 'Stopped' : 'Removed'} ${ids.length} agent${ids.length === 1 ? '' : 's'}.`);
  }
  private fleetAgent(nArg: string | undefined): FleetNode | undefined { const n = Number(nArg); const id = Number.isInteger(n) ? this.fleetIds[n - 1] : undefined; return id ? this.o.fleet!.manager.list().find((x) => x.id === id) : undefined; }
  private async fleetCommand(arg: string) {
    const f = this.o.fleet; if (!f) { this.toast('info', this.o.demo ? 'The fleet needs a real engine (not the demo).' : 'Parallel agents are off in this session.'); return; }
    if (!arg.trim()) { await this.fleetMenu(); return; }
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
        case 'stop': { if (!rest.length) { await this.fleetPick('stop'); break; } if (rest[0] === 'all') { await f.manager.stopAll(); this.toast('ok', 'All fleet agents stopped.'); break; } const n = this.fleetAgent(rest[0]); if (!n) { this.toast('warn', 'Which agent? /fleet stop <number> or /fleet stop all'); return; } await f.manager.stop(n.id as AgentId); this.toast('ok', `Agent ${rest[0]} stopped.`); break; }
        case 'preview': { const n = this.fleetAgent(rest[0]); if (!n) { this.toast('warn', 'Which agent? /fleet preview <number>'); return; } const r = await f.manager.mergePreview(n.id as AgentId); this.notice(r.conflicts.length ? 'warn' : 'ok', r.conflicts.length ? `Merging ${n.branch} would conflict in ${r.conflicts.length} file${r.conflicts.length === 1 ? '' : 's'}.` : `${n.branch} merges cleanly into its base.`, r.conflicts.join('\n') || undefined); break; }
        case 'remove': { if (!rest.length) { await this.fleetPick('remove'); break; } const n = this.fleetAgent(rest[0]); if (!n) { this.toast('warn', 'Which agent? /fleet remove <number> [force]'); return; } await f.manager.remove(n.id as AgentId, { force: rest[1] === 'force' }); this.fleetIds = this.fleetIds.map((x) => (x === n.id ? '' : x)); this.set((s) => ({ agents: s.agents.filter((a) => a.id !== n.id) })); this.toast('ok', `Agent ${rest[0]} and its worktree were removed.`); break; }
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
  async rewindCommand(arg: string, viaMenu = false) {
    if (!this.cp) { this.toast('info', 'Checkpoints are off in this session.'); return; }
    if (this.state.busy) { this.toast('warn', 'Cento is still working. Press Esc to interrupt, then rewind.'); return; }
    await this.cp.ready().catch(() => undefined); const list = [...this.cp.list()].reverse();
    const [nArg, modeArg] = arg.split(/\s+/).filter(Boolean);
    if (!nArg) {
      if (!list.length) { this.notice('info', 'No checkpoints yet. One is saved before every prompt.'); return; }
      const pickedCp = await this.pick({ title: 'Go back to before which prompt?', note: 'Newest first. One is saved before every prompt.', multi: false, confirm: 'next', options: list.slice(0, 30).map((c) => ({ id: String(c.n), label: c.label, hint: `#${c.n}` })) }); if (!pickedCp?.[0]) return;
      const what = await this.pick({ title: 'Put back what?', multi: false, confirm: 'review', options: [{ id: 'files', label: 'The files', hint: 'the folder as it was then' }, { id: 'conversation', label: 'The conversation', hint: 'forget what was said after' }, { id: 'both', label: 'Both' }] }); if (!what?.[0]) return;
      await this.rewindCommand(`${pickedCp[0]} ${what[0]}`, true); return;
    }
    const mode = (modeArg ?? 'files') as RewindMode; if (!['files', 'conversation', 'both'].includes(mode)) { this.toast('warn', 'Rewind what: files, conversation or both?'); return; }
    const target = list.find((c) => String(c.n) === nArg); if (!target) { this.toast('warn', `No checkpoint ${nArg}. Type /rewind to see the list.`); return; }
    let plan; try { plan = await this.cp.preview(target.id, mode); } catch (e) { this.notice('warn', 'Cannot rewind files here.', String((e as Error).message ?? e)); return; }
    const parts: string[] = []; if (plan.restore.length) parts.push(`Put back ${plan.restore.length} file${plan.restore.length === 1 ? '' : 's'}: ${plan.restore.slice(0, 10).join(', ')}`); if (plan.delete.length) parts.push(`Delete ${plan.delete.length} file${plan.delete.length === 1 ? '' : 's'} made since: ${plan.delete.slice(0, 10).join(', ')}`);
    if (plan.skippedModifiedOutside.length) parts.push(`Left alone (changed by someone else since): ${plan.skippedModifiedOutside.slice(0, 10).join(', ')}`);
    if (plan.conversation !== 'none') parts.push(plan.conversation === 'engine-resume' ? 'The conversation goes back to that point.' : 'The conversation starts again from a short summary of what came before.');
    if (mode !== 'conversation') parts.push('Only files in this folder are put back. What commands did elsewhere (installs, network, databases) is not undone.');
    if (!plan.restore.length && !plan.delete.length && plan.conversation === 'none') { this.notice('info', 'Nothing to put back: the files are already as they were then.', plan.skippedModifiedOutside.length ? parts.join('\n') : undefined); return; }
    const pending = { diff: parts.join('\n'), no: 'Nothing was rewound.', apply: async () => {
      const r = await this.cp!.rewind(target.id, mode);
      if (r.conversation) { void this.session?.stop(); this.adopt(r.conversation.session); }
      if (r.failed) return `Stopped part way: ${r.failed.unrestored.length} file(s) not put back. Your state before the rewind is saved: /rewind ${this.cp!.list().at(-1)?.n ?? ''} undoes it.`;
      return `Rewound to before "${target.label}": ${r.restored.length} put back, ${r.deleted.length} removed${r.skipped.length ? `, ${r.skipped.length} left alone` : ''}.${r.undoRef ? ` To undo, /rewind ${this.cp!.list().at(-1)?.n}.` : ''}${r.conversation?.resumeError ? ` (The tool said: ${r.conversation.resumeError})` : ''}`;
    } };
    if (viaMenu) { // from the guided flow: review, then confirm from a list
      this.addItem({ kind: 'notice', id: nid('n'), level: 'info', text: `Rewind to before "${target.label}"`, detail: parts.join('\n') });
      const ok = await this.pick({ title: `Rewind to before "${target.label}"?`, note: 'The details are above in the conversation.', multi: false, confirm: 'ok', options: [{ id: 'yes', label: 'Yes, rewind' }, { id: 'no', label: 'No, leave everything as it is' }] });
      if (ok?.[0] === 'yes') { try { this.addItem({ kind: 'notice', id: nid('n'), level: 'ok', text: await pending.apply() }); } catch (e) { this.addItem({ kind: 'notice', id: nid('n'), level: 'warn', text: 'Could not rewind: ' + String((e as Error).message ?? e) }); } } else this.notice('info', pending.no);
      return;
    }
    this.pendingMemory = pending;
    this.addItem({ kind: 'notice', id: nid('n'), level: 'info', text: `Rewind to before "${target.label}"? Type y to confirm, anything else cancels.`, detail: parts.join('\n') });
  }
  /** Esc twice within 600 ms while idle opens the checkpoint list. */
  escIdle() { if (this.pendingAnswer) { this.cancelQuestions(); return; } const now = Date.now(); if (now - this.lastEsc < 600) { this.lastEsc = 0; void this.rewindCommand(''); } else this.lastEsc = now; }

  /* ------------------------------------------------------------------ permissions */
  private async permissionsCommand(arg: string) {
    const p = this.o.policy; if (!p) { this.toast('info', 'Saved permission rules are not used in this session.'); return; }
    const [sub, id] = arg.split(/\s+/).filter(Boolean);
    if (sub === 'remove' && id) { const ok = await p.engine.rules.remove(id); this.toast(ok ? 'ok' : 'warn', ok ? `Rule ${id} removed.` : `There is no rule ${id}.`); return; }
    const rules = p.engine.rules.list(p.root); const warn = p.engine.rules.warnings(); const trust = p.engine.rules.needsTrust();
    if (!sub && rules.length) { // a list to tick: the rules to take away
      const ids = await this.pick({ title: 'Saved permission rules', note: 'Tick the ones to remove. They are checked before the permission mode.', options: rules.map((r) => ({ id: r.id, label: `${r.tool}${r.matcher?.command ? ' ' + r.matcher.command : ''}`, hint: r.action })), confirm: 'remove' });
      if (ids?.length) { let n = 0; for (const id of ids) if (await p.engine.rules.remove(id)) n++; this.toast('ok', `Removed ${n} rule${n === 1 ? '' : 's'}.`); }
      return;
    }
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

  /** A short message over the corner of the screen. Said again while still showing, it stays instead of stacking; problems stay longer than good news. */
  toast(level: 'info' | 'ok' | 'warn' | 'error', text: string, ms = level === 'error' ? 7000 : level === 'warn' ? 5000 : 3800) {
    const same = this.state.toasts.find((t) => t.level === level && t.text === text); const id = same?.id ?? nid('toast');
    if (same) { const old = this.toastTimers.get(id); if (old) clearTimeout(old); this.set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, until: Date.now() + ms } : t)) })); }
    else this.set((s) => ({ toasts: [...s.toasts.slice(-2), { id, level, text, until: Date.now() + ms }] }));
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

export function modeLabel(m: PermissionMode): string {
  return m === 'plan' ? 'Plan mode: read-only, nothing is changed' : m === 'acceptEdits' ? 'Accept edits: file edits go through, commands still ask' : m === 'bypassPermissions' ? 'Bypass: everything but dangerous commands is allowed' : 'Default: ask before edits and commands';
}
