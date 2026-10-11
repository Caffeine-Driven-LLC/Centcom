import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeEngine, CodexEngine, DemoEngine, newId, type AgentEngine, type Board } from '@centcom/agent';
import { appLogger } from './logger.js';
import { AppController, ClientConfig, SessionStore, buildRuntime, initialSettings, settingsFromConfig, type Item } from '@centcom/tui';
import type { BoardNote, RunningSession, ServerMsg, WebState } from './protocol.js';

/** One running agent session for one directory, shared by every browser tab or app window that opens it. */
export class Workspace {
  readonly ctl: AppController;
  private clients = new Set<(m: ServerMsg) => void>();
  private sent = new Map<string, string>();
  private lastBoard = '';
  private unsub: () => void;
  private listeners = new Set<() => void>();

  private constructor(readonly dir: string, ctl: AppController, private cc: ClientConfig, readonly which: 'claude-code' | 'codex', readonly demo: boolean, private board?: Board) {
    this.ctl = ctl;
    this.unsub = ctl.store.subscribe(() => this.push());
  }

  static async open(dir: string, demo: boolean, which: 'claude-code' | 'codex' = 'claude-code', resume?: string): Promise<Workspace> {
    const engine: AgentEngine = demo ? new DemoEngine({ speed: 1 }) : which === 'codex' ? new CodexEngine() : new ClaudeCodeEngine();
    let branch = ''; try { branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a repo */ }
    const cc = await ClientConfig.load(dir); // this folder's project file counts too
    if (!demo) cc.set('client.engine', which); // remember the agent you picked
    const settings = settingsFromConfig(cc.cfg);
    const logger = appLogger(cc.cfg.log).child({ component: 'web', session_id: newId('ses') }); // one shared file sink for the whole server, one binding per workspace
    const rt = await buildRuntime({ cwd: dir, engineId: engine.id, demo, dangerous: settings.permissionMode === 'bypassPermissions' });
    const ctl = new AppController({ ...rt.options, logger, engine, demo, cwd: dir, branch, version: '0.1.0', ghosts: false, permissionMode: settings.permissionMode, settings, ...cc.options({ ...initialSettings(), ...settings }, { saveHistory: !demo }), night: demo ? undefined : { dir: join(homedir(), '.centcom', 'night') }, sessions: demo ? undefined : new SessionStore(), resume: demo ? undefined : resume });
    const ws = new Workspace(dir, ctl, cc, which, demo, rt.options.board);
    rt.bind(ctl);
    await ctl.start();
    for (const w of rt.warnings) ctl.notice('warn', w);
    for (const w of cc.warnings) ctl.notice('warn', 'Settings: ' + w);
    cc.onWarn = (w) => ctl.notice('warn', 'Settings: ' + w);
    return ws;
  }

  join(send: (m: ServerMsg) => void): () => void {
    this.clients.add(send); this.sent.clear(); this.lastBoard = ''; this.push(); // a new client needs everything again
    return () => { this.clients.delete(send); };
  }

  /** Prompt history for a joining client: sent once with `opened`, never with every state push. */
  history(): string[] { return [...this.ctl.state.history]; }

  private snapshot(): { state: WebState; items: Item[] } {
    const s = this.ctl.state;
    const { items, approvals, history, input, cursor, histIdx, draft, scroll, palette, gallery, slashSel, mode, ...rest } = s;
    void history; void input; void cursor; void histIdx; void draft; void scroll; void palette; void gallery; void slashSel; void mode;
    return { items, state: { ...rest, approvals: approvals.map((a) => ({ id: a.req.approval_id, tool: a.req.tool, summary: a.req.summary, risk: a.req.risk, path: a.req.path, command: a.req.command, diff: a.req.diff, agentName: a.agentName })) } };
  }

  /** Called after every change of the session, even when no window shows it. Returns how to stop. */
  onChange(f: () => void): () => void { this.listeners.add(f); return () => { this.listeners.delete(f); }; }

  /** The context board as the screen shows it: newest first, at most 30. */
  notes(): { enabled: boolean; notes: BoardNote[] } {
    if (!this.board) return { enabled: false, notes: [] };
    return { enabled: true, notes: this.board.list().slice(-30).reverse().map((e) => ({ id: e.id, type: e.type, text: e.text, author: e.author.name, person: e.author.kind === 'person', pinned: e.pinned, ts: e.ts, files: e.refs.files.slice(0, 5) })) };
  }
  pinNote(id: string, pinned: boolean): void { this.board?.pin(id, pinned); this.lastBoard = ''; this.push(); }
  removeNote(id: string): void { this.board?.retract(id); this.lastBoard = ''; this.push(); }

  /** What the session list needs to know about this one. */
  status(): RunningSession {
    const a = this.ctl.state.approvals;
    return { dir: this.dir, engine: this.which, demo: this.demo, busy: this.ctl.state.busy, waiting: a.length, ...(a[0] ? { ask: a[0].req.summary } : {}) };
  }

  private push() {
    for (const f of [...this.listeners]) { try { f(); } catch { /* a listener must not stop the session */ } }
    if (!this.clients.size) return;
    const { state, items } = this.snapshot();
    const changed: Item[] = [];
    for (const it of items) { const j = JSON.stringify(it); if (this.sent.get(it.id) !== j) { this.sent.set(it.id, j); changed.push(it); } }
    const msg: ServerMsg = { t: 'state', state, changed, order: items.map((i) => i.id) };
    for (const c of this.clients) c(msg);
    const b = this.notes(); const bj = JSON.stringify(b); if (bj !== this.lastBoard) { this.lastBoard = bj; for (const c of this.clients) c({ t: 'board', ...b }); }
  }

  close() { this.unsub(); this.listeners.clear(); this.ctl.stop(); this.cc.flush(); this.clients.clear(); }
}
