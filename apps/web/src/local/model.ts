import type { BoardNote, RunningSession, ServerMsg, WebState } from '../../../desktop/src/local/protocol.js';
import type { Item } from '@centcom/tui';

export type Launcher = Extract<ServerMsg, { t: 'launcher' }>;
export type DirMsg = Extract<ServerMsg, { t: 'dir' }>;
export interface Notice { level: 'info' | 'warn' | 'error'; text: string; n: number }
/** Everything the local-session screens show, rebuilt from the messages the main process sends. */
export interface LocalView { launcher?: Launcher; dir?: DirMsg; opened?: string; /** Which agent the shown session is (Claude Code or Codex), once the desktop says. */ openedEngine?: { engine: 'claude-code' | 'codex'; demo: boolean }; history: string[]; /** Every agent session that is alive, shown or not. */ running: RunningSession[]; /** The context board of the shown session; `enabled` false when it is turned off. */ board: { enabled: boolean; notes: BoardNote[] }; state?: WebState; items: Item[]; notice?: Notice; models: Models; byId: ReadonlyMap<string, Item> }
export type Models = Extract<ServerMsg, { t: 'models' }>['models'];
export const emptyView = (): LocalView => ({ models: [], history: [], running: [], board: { enabled: false, notes: [] }, items: [], byId: new Map() });
/** One message in, the next view out. State messages carry only the items that changed plus the full order, so unchanged items keep their identity. */
export function reduceLocal(v: LocalView, m: ServerMsg): LocalView {
  switch (m.t) {
    case 'launcher': return { ...v, launcher: m };
    case 'dir': return { ...v, dir: m };
    case 'models': return { ...v, models: m.models };
    case 'running': return { ...v, running: m.sessions };
    case 'board': return { ...v, board: { enabled: m.enabled, notes: m.notes } };
    case 'opened': return { ...v, opened: m.dir, openedEngine: m.engine ? { engine: m.engine, demo: !!m.demo } : undefined, history: m.history ?? [], state: undefined, items: [], byId: new Map(), models: [], board: { enabled: false, notes: [] } };
    case 'closed': return { ...v, opened: undefined, openedEngine: undefined, state: undefined, items: [], byId: new Map(), board: { enabled: false, notes: [] } };
    case 'notice': return { ...v, notice: { level: m.level, text: m.text, n: (v.notice?.n ?? 0) + 1 } };
    case 'state': { const byId = new Map(v.byId); for (const it of m.changed) byId.set(it.id, it); return { ...v, byId, state: m.state, items: m.order.map((id) => byId.get(id)).filter((x): x is Item => !!x) }; }
    default: return v;
  }
}
const short = (p: string, home: string): string => (home && p.startsWith(home) ? '~' + p.slice(home.length) : p);
export const shortPath = short;
/** Where the engine stands, in words: what the header says and whether the composer may send. */
export function engineStatus(l: Launcher, engine: 'claude-code' | 'codex'): { ok: boolean; text: string } {
  const st = engine === 'codex' ? l.codex : l.claude; const name = engine === 'codex' ? 'Codex' : 'Claude Code';
  if (!st.installed) return { ok: false, text: `${name} was not found. You can still try the demo agent.` };
  if (st.signedIn === 'no') return { ok: false, text: `Not signed in. Run ${engine === 'codex' ? 'codex login' : 'claude auth login'} in a terminal.` };
  return { ok: true, text: `${name} ${st.version ?? ''} · ${st.kind === 'subscription' ? 'your subscription' : st.kind === 'api_key' ? 'your API key' : 'ready'}`.replace(/\s+/g, ' ') };
}
/** Engine to preselect: the saved choice, unless only the other one is installed. */
export function pickEngine(l: Launcher): { engine: 'claude-code' | 'codex'; demo: boolean } {
  if (!l.claude.installed && !l.codex.installed) return { engine: 'claude-code', demo: true };
  if (!l.claude.installed) return { engine: 'codex', demo: false };
  if (!l.codex.installed) return { engine: 'claude-code', demo: false };
  return { engine: l.prefs.engine, demo: false };
}

/** "just now", "5 min ago", "3 h ago", "2 days ago" for the recent list. */
export function whenAgo(at: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - at) / 60000)); if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 24) return `${h} h ago`; const d = Math.round(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** Is this running session the one the window shows? (Same folder; the agent matters only if the folder has two.) */
export const isShown = (r: RunningSession, view: LocalView): boolean => r.dir === view.opened && (view.openedEngine ? r.engine === view.openedEngine.engine && r.demo === view.openedEngine.demo : view.state?.demo ? r.demo : !r.demo);

/** The agents a project can be run with here: both tabs show only when both are installed. */
export const installedEngines = (l: Launcher | undefined): ('claude-code' | 'codex')[] => (l ? ([l.claude.installed ? 'claude-code' : null, l.codex.installed ? 'codex' : null].filter(Boolean) as ('claude-code' | 'codex')[]) : []);
/** What a session row says. */
export const runningWord = (r: Pick<RunningSession, 'busy' | 'waiting'>): 'needs you' | 'working' | 'ready' => (r.waiting > 0 ? 'needs you' : r.busy ? 'working' : 'ready');
