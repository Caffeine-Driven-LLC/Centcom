import { execFileSync } from 'node:child_process';
import { ClaudeCodeEngine, CodexEngine, DemoEngine, type AgentEngine } from '@centcom/agent';
import { AppController, SessionStore, type Item } from '@centcom/tui';
import type { ServerMsg, WebState } from './protocol.js';

/** One running agent session for one directory, shared by every browser tab or app window that opens it. */
export class Workspace {
  readonly ctl: AppController;
  private clients = new Set<(m: ServerMsg) => void>();
  private sent = new Map<string, string>();
  private unsub: () => void;

  private constructor(readonly dir: string, ctl: AppController) {
    this.ctl = ctl;
    this.unsub = ctl.store.subscribe(() => this.push());
  }

  static async open(dir: string, demo: boolean, which: 'claude-code' | 'codex' = 'claude-code', resume?: string): Promise<Workspace> {
    const engine: AgentEngine = demo ? new DemoEngine({ speed: 1 }) : which === 'codex' ? new CodexEngine() : new ClaudeCodeEngine();
    let branch = ''; try { branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a repo */ }
    const ctl = new AppController({ engine, demo, cwd: dir, branch, version: '0.1.0', ghosts: false, permissionMode: 'default', sessions: demo ? undefined : new SessionStore(), resume: demo ? undefined : resume });
    const ws = new Workspace(dir, ctl);
    await ctl.start();
    return ws;
  }

  join(send: (m: ServerMsg) => void): () => void {
    this.clients.add(send); this.sent.clear(); this.push(); // a new client needs everything again
    return () => { this.clients.delete(send); };
  }

  private snapshot(): { state: WebState; items: Item[] } {
    const s = this.ctl.state;
    const { items, approvals, input, cursor, history, histIdx, draft, scroll, palette, modelSel, gallery, slashSel, mode, ...rest } = s;
    void input; void cursor; void history; void histIdx; void draft; void scroll; void palette; void modelSel; void gallery; void slashSel; void mode;
    return { items, state: { ...rest, approvals: approvals.map((a) => ({ id: a.req.approval_id, tool: a.req.tool, summary: a.req.summary, risk: a.req.risk, path: a.req.path, command: a.req.command, diff: a.req.diff, agentName: a.agentName })) } };
  }

  private push() {
    if (!this.clients.size) return;
    const { state, items } = this.snapshot();
    const changed: Item[] = [];
    for (const it of items) { const j = JSON.stringify(it); if (this.sent.get(it.id) !== j) { this.sent.set(it.id, j); changed.push(it); } }
    const msg: ServerMsg = { t: 'state', state, changed, order: items.map((i) => i.id) };
    for (const c of this.clients) c(msg);
  }

  close() { this.unsub(); this.ctl.stop(); this.clients.clear(); }
}
