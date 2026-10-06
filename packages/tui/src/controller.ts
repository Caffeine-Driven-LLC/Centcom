/**
 * AppController: owns the engine session, turns normalised engine events into transcript items and agent states,
 * answers approvals through the permission policy, runs slash commands, and drives the mascot.
 * The React tree only reads the store and calls the controller's methods.
 */
import { discover, injection, match, type Skill } from '@centcom/skills';
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
      items: [], agents: [me], activeAgent: this.me, mode: 'chat', input: '', cursor: 0, history: [], histIdx: null, draft: '', scroll: 0, toasts: [], approvals: [], settings,
      busy: false, verb: this.verbs.next(), limits: [], cwd: o.cwd, branch: o.branch ?? '', engineId: o.engine.id, engineLabel: o.engine.label, demo: o.demo, fleet: true,
      slashSel: 0, palette: { query: '', sel: 0 }, gallery: { cat: 0, idx: 0, color: 0, query: '' }, version: o.version,
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
    this.driver.setState(this.o.demo ? 'ready' : 'ready');
    const gate: PermissionGate = { decide: (r) => this.decide(r) };
    this.session = await this.o.engine.start({ agentId: this.me, cwd: this.o.cwd, permissionMode: this.state.settings.permissionMode, approvalGate: gate });
    void this.consume(this.session);
    if (this.o.ghosts) this.startGhosts();
    this.verbTimer = setInterval(() => { if (this.state.busy) this.set({ verb: this.verbs.next() }); }, 4200);
    this.verbTimer.unref?.();
  }

  stop() {
    this.driver.stop(); this.ghostTimers.forEach(clearTimeout); if (this.verbTimer) clearInterval(this.verbTimer);
    this.toastTimers.forEach(clearTimeout);
    for (const a of this.state.approvals) a.resolve({ decision: 'deny', scope: 'once', reason: 'exit' });
    void this.session?.stop();
  }

  private async consume(s: EngineSession) { for await (const ev of s.events) this.apply(ev); }

  /* ------------------------------------------------------------------ events -> state */
  apply(ev: NormalisedEvent) {
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
      case 'usage.report': this.updateAgent(me, () => ({ cost: ev.cost_usd ?? 0, inTok: ev.input_tokens, outTok: ev.output_tokens })); break;
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
    const write = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(r.tool);
    if (this.sessionRules.has(this.ruleKey(r)) && r.risk !== 'high') return Promise.resolve({ decision: 'approve', scope: 'session' });
    if (mode === 'plan' && (write || r.tool === 'Bash') && r.risk !== 'low') return Promise.resolve({ decision: 'deny', scope: 'once', reason: 'plan mode is read-only' });
    if (r.risk === 'low') return Promise.resolve({ decision: 'approve', scope: 'once' });
    if (mode === 'bypassPermissions' && r.risk !== 'high') return Promise.resolve({ decision: 'approve', scope: 'once' });
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
    this.set((s) => ({ history: [...s.history.filter((h) => h !== text), text].slice(-100), histIdx: null, draft: '', input: '', cursor: 0, scroll: 0, slashSel: 0 }));
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

  private skillCache?: Skill[];
  skills(): Skill[] { return (this.skillCache ??= this.o.skills ?? discover({ cwd: this.o.cwd })); }

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
    const cur = this.state.settings.permissionMode; const next = MODES[(MODES.indexOf(cur) + 1) % MODES.length]!;
    this.setSettings({ permissionMode: next }); this.session?.setPermissionMode?.(next); this.toast('info', modeLabel(next));
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
      case 'clear': this.set({ items: [], scroll: 0 }); break;
      case 'agents': this.set((s) => ({ fleet: !s.fleet })); break;
      case 'quit': this.o.onExit?.(); break;
      case 'interrupt': await this.interrupt(); break;
      case 'mode': { const m = arg as PermissionMode; if (MODES.concat('bypassPermissions').includes(m)) { this.setSettings({ permissionMode: m }); this.session?.setPermissionMode?.(m); this.toast('info', modeLabel(m)); } else this.toast('info', `Mode: ${modeLabel(this.state.settings.permissionMode)}. Try /mode plan`); break; }
      case 'mascot': if (['large', 'small', 'off', 'auto'].includes(arg)) this.setSettings({ mascot: arg as Settings['mascot'] }); else this.toast('info', 'Try /mascot large, small, off or auto'); break;
      case 'color': if (['violet', 'red', 'yellow', 'green', 'brown'].includes(arg)) this.setSettings({ color: arg as CentoColor }); else this.toast('info', 'Colours: violet red yellow green brown'); break;
      case 'theme': if (arg === 'dark' || arg === 'light') this.setSettings({ theme: arg }); else this.toast('info', 'Try /theme dark or /theme light'); break;
      case 'auto': {
        const on = arg ? arg === 'on' : !this.state.settings.autoSkills; this.setSettings({ autoSkills: on });
        this.toast('info', on ? `Auto skills on (${this.skills().length} found)` : 'Auto skills off'); break;
      }
      case 'skills': {
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
