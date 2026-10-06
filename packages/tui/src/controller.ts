/**
 * AppController: owns the engine session, turns normalised engine events into transcript items and agent states,
 * answers approvals through the permission policy, runs slash commands, and drives the mascot.
 * The React tree only reads the store and calls the controller's methods.
 */
import { CLAUDE_MODELS, modelLabel, newId } from '@centcom/agent';
import { SessionStore, ago, titleFrom, type SessionMeta } from './sessions.js';
import { MASTER_DIR, discover, injection, masterSkills, match, setEnabled, type Skill } from '@centcom/skills';
import { MascotDriver, bakedByCategory, bakedCategories, getBaked, type CentoColor } from '@centcom/mascot';
import type { AgentEngine, ApprovalDecision, ApprovalRequest, EngineSession, NormalisedEvent, PermissionGate, PermissionMode } from '@centcom/agent';
import { Store } from './state/store.js';
import { initialSettings, isBusyState, stateToMini, type AgentView, type AppState, type Item, type PendingApproval, type Settings } from './state/model.js';
import { COMMANDS } from './state/commands.js';
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
  /** Called with every engine event, before the UI state changes (used by print mode and stream-json). */
  onEvent?: (ev: NormalisedEvent) => void;
  /** Continue a saved conversation: 'last' for the newest one in this folder, or a session id. */
  resume?: string;
  /** Started with --dangerously-skip-permissions: Shift+Tab can cycle into bypass. */
  dangerous?: boolean;
}

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

  constructor(private o: ControllerOptions) {
    this.verbs = o.verbs ?? new VerbRotator();
    const settings = { ...initialSettings(), permissionMode: o.permissionMode ?? 'default', ...o.settings };
    const me: AgentView = { id: this.me, name: 'you', color: settings.color, mine: true, engine: o.engine.label, provider: o.engine.provider, model: '', loginKind: 'unknown', state: 'idle', mini: 'idle', busy: false, branch: o.branch ?? '', runsOn: 'you', cost: 0, inTok: 0, outTok: 0 };
    this.store = new Store<AppState>({
      items: [], agents: [me], activeAgent: this.me, mode: 'chat', input: '', cursor: 0, history: o.history ?? [], histIdx: null, draft: '', scroll: 0, toasts: [], approvals: [], settings,
      busy: false, verb: this.verbs.next(), limits: [], cwd: o.cwd, branch: o.branch ?? '', engineId: o.engine.id, engineLabel: o.engine.label, demo: o.demo, fleet: true,
      slashSel: 0, palette: { query: '', sel: 0 }, modelSel: 0, gallery: { cat: 0, idx: 0, color: 0, query: '' }, version: o.version, sessionId: newId('ses'), sessions: [],
    });
    this.driver = new MascotDriver({ reducedMotion: settings.reducedMotion, color: settings.color });
  }

  get state() { return this.store.get(); }
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

  private async startEngine(resumeToken?: string) {
    const gate: PermissionGate = { decide: (r) => this.decide(r) };
    this.session = await this.o.engine.start({ agentId: this.me, cwd: this.o.cwd, permissionMode: this.state.settings.permissionMode, model: this.state.settings.model || undefined, addDirs: this.o.demo ? undefined : [MASTER_DIR], approvalGate: gate, ...(resumeToken ? { resume: { engine_session_id: resumeToken } } : {}) });
    void this.consume(this.session);
  }

  /* ------------------------------------------------------------------ saved conversations */
  private persistTimer?: NodeJS.Timeout; private lastItems?: Item[]; private lastToken?: string; private lastSid = '';
  private schedulePersist() {
    if (!this.o.sessions || this.persistTimer) return;
    this.persistTimer = setTimeout(() => { this.persistTimer = undefined; this.persist(); }, 600); this.persistTimer.unref?.();
  }
  persist() {
    const st = this.o.sessions; const s = this.state; if (!st || !s.items.length) return;
    const first = s.items.find((i) => i.kind === 'user');
    const meta: SessionMeta = { id: s.sessionId, cwd: this.o.cwd, engine: this.o.engine.id, title: titleFrom(s.items), model: s.settings.model || undefined, resumeToken: this.session?.resumeToken(), createdAt: this.createdAt ?? (first && first.kind === 'user' ? first.ts : Date.now()), updatedAt: Date.now(), messages: s.items.filter((i) => i.kind === 'user').length };
    this.createdAt = meta.createdAt;
    // items are replaced (never mutated) on every change, so identity tells us whether anything new needs saving
    if (s.items === this.lastItems && meta.resumeToken === this.lastToken && s.sessionId === this.lastSid) return;
    this.lastItems = s.items; this.lastToken = meta.resumeToken; this.lastSid = s.sessionId;
    try { st.save(meta, s.items); this.refreshSessions(); } catch (e) { this.toast('warn', 'Could not save this conversation: ' + String((e as Error).message ?? e)); }
  }
  private createdAt?: number;
  private refreshSessions() { if (this.o.sessions) this.set({ sessions: this.o.sessions.list(this.o.cwd, 10) }); }
  private loadSaved(meta: SessionMeta, items: Item[]) {
    this.createdAt = meta.createdAt;
    this.set({ sessionId: meta.id, items, scroll: 0, ...(meta.model !== undefined ? { settings: { ...this.state.settings, model: meta.model ?? '' } } : {}) });
    this.addItem({ kind: 'notice', id: nid('n'), level: 'ok', text: `Continuing "${meta.title}"`, detail: `${meta.messages} message${meta.messages === 1 ? '' : 's'} · last used ${ago(meta.updatedAt)}` });
  }
  /** Start over with an empty context. The old conversation stays saved and can be resumed. */
  async newSession() {
    if (this.state.busy) { this.toast('warn', 'Cento is still working. Press Esc to interrupt, then try again.'); return; }
    this.persist(); await this.session?.stop();
    this.createdAt = undefined; this.lastItems = undefined;
    this.set({ items: [], scroll: 0, sessionId: newId('ses'), approvals: [] });
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
    if (!list.length) { this.addItem({ kind: 'notice', id: nid('n'), level: 'info', text: 'No saved conversations in this folder yet.' }); return; }
    this.addItem({ kind: 'notice', id: nid('n'), level: 'info', text: 'Saved conversations in this folder. Type /resume 1 (or another number) to continue one.', detail: list.map((m, i) => `${i + 1}${m.id === this.state.sessionId ? '*' : ' '} ${m.title}  ·  ${m.messages} msg  ·  ${ago(m.updatedAt)}`).join('\n') });
  }

  stop() {
    this.persist();
    this.driver.stop(); this.ghostTimers.forEach(clearTimeout); if (this.verbTimer) clearInterval(this.verbTimer);
    this.toastTimers.forEach(clearTimeout);
    for (const a of this.state.approvals) a.resolve({ decision: 'deny', scope: 'once', reason: 'exit' });
    void this.session?.stop();
  }

  private async consume(s: EngineSession) { for await (const ev of s.events) this.apply(ev); }

  /* ------------------------------------------------------------------ events -> state */
  apply(ev: NormalisedEvent) {
    this.o.onEvent?.(ev);
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

  /* ------------------------------------------------------------------ approvals (permission policy) */
  private ruleKey(r: ApprovalRequest) { return `${r.tool}:${r.command ?? r.path ?? ''}`; }
  decide(r: ApprovalRequest): Promise<ApprovalDecision> {
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

  answerApproval(decision: 'approve' | 'deny', scope: 'once' | 'session' | 'always' = 'once') {
    const [first, ...rest] = this.state.approvals;
    if (!first) return;
    if (decision === 'approve' && scope !== 'once') this.sessionRules.add(this.ruleKey(first.req));
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

  async submit(raw: string) {
    const text = raw.trim();
    if (!text) return;
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
    this.setSettings({ permissionMode: m }); this.session?.setPermissionMode?.(m);
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
