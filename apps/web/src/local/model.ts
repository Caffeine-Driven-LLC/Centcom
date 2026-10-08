import type { ServerMsg, WebState } from '../../../desktop/src/local/protocol.js';
import type { Item } from '@centcom/tui';

export type Launcher = Extract<ServerMsg, { t: 'launcher' }>;
export type DirMsg = Extract<ServerMsg, { t: 'dir' }>;
export interface Notice { level: 'info' | 'warn' | 'error'; text: string; n: number }
/** Everything the local-session screens show, rebuilt from the messages the main process sends. */
export interface LocalView { launcher?: Launcher; dir?: DirMsg; opened?: string; history: string[]; state?: WebState; items: Item[]; notice?: Notice; models: Models; byId: ReadonlyMap<string, Item> }
export type Models = Extract<ServerMsg, { t: 'models' }>['models'];
export const emptyView = (): LocalView => ({ models: [], history: [], items: [], byId: new Map() });
/** One message in, the next view out. State messages carry only the items that changed plus the full order, so unchanged items keep their identity. */
export function reduceLocal(v: LocalView, m: ServerMsg): LocalView {
  switch (m.t) {
    case 'launcher': return { ...v, launcher: m };
    case 'dir': return { ...v, dir: m };
    case 'models': return { ...v, models: m.models };
    case 'opened': return { ...v, opened: m.dir, history: m.history ?? [], state: undefined, items: [], byId: new Map(), models: [] };
    case 'closed': return { ...v, opened: undefined, state: undefined, items: [], byId: new Map() };
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
