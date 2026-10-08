/** The local session service: one per app. It is what the old localhost server did, minus the server: the app's screens talk to it over Electron IPC, so no port is opened and no token is needed. */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { detectClaude, detectCodex } from '@centcom/agent';
import { ClientConfig, SessionStore } from '@centcom/tui';
import { Workspace } from './workspace.js';
import type { ClientMsg, DirEntry, Prefs, RecentDir, ServerMsg } from './protocol.js';

export const MAX_TEXT = 100_000; export const MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const;
export interface ServiceOptions { home?: string; stateDir?: string; cwd?: string; version?: string }
/** Reads a folder for the picker: no hidden folders, no node_modules, git folders first, at most 400 entries. */
export function listDir(path: string, home: string): { path: string; parent: string | null; git: boolean; entries: DirEntry[]; error?: string } {
  const p = resolve(path || home); const parent = dirname(p) === p ? null : dirname(p);
  try { const entries: DirEntry[] = []; for (const name of readdirSync(p)) { if (name.startsWith('.') || name === 'node_modules') continue; try { if (statSync(join(p, name)).isDirectory()) entries.push({ name, git: existsSync(join(p, name, '.git')) }); } catch { /* unreadable entry */ } } entries.sort((a, b) => Number(b.git) - Number(a.git) || a.name.localeCompare(b.name)); return { path: p, parent, git: existsSync(join(p, '.git')), entries: entries.slice(0, 400) }; }
  catch (e) { return { path: p, parent, git: false, entries: [], error: (e as NodeJS.ErrnoException).code === 'EACCES' ? 'No permission to read this folder.' : 'Cannot read this folder.' }; }
}
/** A message from a screen is trusted for nothing: the type is checked, text is capped, enums are matched. */
export function sanitise(raw: unknown): ClientMsg | undefined {
  if (!raw || typeof raw !== 'object' || typeof (raw as { t?: unknown }).t !== 'string') return undefined; const m = raw as Record<string, unknown>; const t = m.t as string;
  const str = (v: unknown, max = 4096): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined);
  switch (t) {
    case 'hello': case 'close': case 'interrupt': case 'cycleMode': return { t } as ClientMsg;
    case 'browse': { const p = str(m.path); return p === undefined ? undefined : { t, path: p }; }
    case 'open': { const dir = str(m.dir); if (!dir) return undefined; return { t, dir, demo: m.demo === true, engine: m.engine === 'codex' ? 'codex' : 'claude-code', ...(str(m.resume, 200) ? { resume: str(m.resume, 200) } : {}) }; }
    case 'pref': return { t, ...(m.theme === 'auto' || m.theme === 'dark' || m.theme === 'light' ? { theme: m.theme } : {}), ...(typeof m.side === 'boolean' ? { side: m.side } : {}) };
    case 'submit': { const text = str(m.text, MAX_TEXT * 2); return text === undefined ? undefined : { t, text: text.slice(0, MAX_TEXT) }; }
    case 'approve': return { t, decision: m.decision === 'approve' ? 'approve' : 'deny', ...(m.scope === 'session' || m.scope === 'always' ? { scope: m.scope } : {}) };
    case 'setModel': { const id = str(m.id, 200); return id === undefined ? undefined : { t, id }; }
    case 'setMode': return (MODES as readonly unknown[]).includes(m.mode) ? { t, mode: m.mode as (typeof MODES)[number] } : undefined;
    case 'models': case 'compact': return { t } as ClientMsg;
    case 'setEffort': { const e = str(m.effort, 40); return e === undefined || !/^[\w-]*$/.test(e) ? undefined : { t, effort: e }; }
    case 'auto': return { t, on: m.on === true };
    default: return undefined;
  }
}
export class LocalService {
  private readonly home: string; private readonly stateDir: string; private readonly cwd: string; private workspaces = new Map<string, Workspace>(); private appCfg?: ClientConfig; private warned = false;
  private sessions = new Map<unknown, { current?: Workspace; leave?: () => void; send(m: ServerMsg): void }>();
  constructor(o: ServiceOptions = {}) { this.home = o.home ?? homedir(); this.stateDir = o.stateDir ?? join(this.home, '.centcom'); this.cwd = o.cwd ?? this.home; mkdirSync(this.stateDir, { recursive: true, mode: 0o700 }); }
  private recentFile = (): string => join(this.stateDir, 'recent.json');
  recent(): RecentDir[] { try { return (JSON.parse(readFileSync(this.recentFile(), 'utf8')) as RecentDir[]).filter((r) => existsSync(r.dir)); } catch { return []; } }
  private addRecent(dir: string): void { const r = [{ dir, at: Date.now() }, ...this.recent().filter((x) => x.dir !== dir)].slice(0, 12); try { writeFileSync(this.recentFile(), JSON.stringify(r)); } catch { /* not critical */ } }
  private async prefs(): Promise<Prefs> { this.appCfg ??= await ClientConfig.load(this.cwd); return { theme: this.appCfg.get('ui.theme') as Prefs['theme'], side: this.appCfg.get('client.side_panel') as boolean, engine: (this.appCfg.get('client.engine') === 'codex' ? 'codex' : 'claude-code') }; }
  private async savePref(m: { theme?: Prefs['theme']; side?: boolean }): Promise<void> { await this.prefs(); if (m.theme) this.appCfg!.set('ui.theme', m.theme); if (typeof m.side === 'boolean') this.appCfg!.set('client.side_panel', m.side); this.appCfg!.flush(); }
  /** Attach a window: `send` is how messages reach its screen. Returns what the window calls for each message and when it goes. */
  attach(key: unknown, send: (m: ServerMsg) => void): { handle(raw: unknown): Promise<void>; detach(): void } {
    const s: { current?: Workspace; leave?: () => void; send(m: ServerMsg): void } = { send }; this.sessions.set(key, s);
    const detach = (): void => { s.leave?.(); s.leave = undefined; s.current = undefined; };
    return { detach: () => { detach(); this.sessions.delete(key); }, handle: async (raw) => { const m = sanitise(raw); if (!m) return; try { await this.dispatch(s, m, detach); } catch (e) { send({ t: 'notice', level: 'error', text: e instanceof Error ? e.message : String(e) }); } } };
  }
  private async dispatch(s: { current?: Workspace; leave?: () => void; send(m: ServerMsg): void }, m: ClientMsg, detach: () => void): Promise<void> {
    const send = s.send;
    switch (m.t) {
      case 'hello': { const [st, cx] = await Promise.all([detectClaude(), detectCodex()]); send({ t: 'launcher', home: this.home, cwd: this.cwd, recent: this.recent(), claude: { installed: st.installed, version: st.version, signedIn: st.signedIn, kind: st.loginKind }, codex: { installed: cx.installed, version: cx.version, signedIn: cx.signedIn, kind: cx.loginKind }, prefs: await this.prefs() }); if (this.appCfg && !this.warned) { this.warned = true; for (const w of this.appCfg.warnings) send({ t: 'notice', level: 'warn', text: 'Settings: ' + w }); } if (s.current) send({ t: 'opened', dir: s.current.dir, history: s.current.history() }); break; }
      case 'browse': { const d = listDir(m.path, this.home); send({ t: 'dir', ...d, saved: new SessionStore().list(d.path, 50).length }); break; }
      case 'open': { const dir = resolve(m.dir); const key = `${dir}::${m.demo ? 'demo' : m.engine ?? 'claude-code'}`; if (!existsSync(dir) || !statSync(dir).isDirectory()) { send({ t: 'notice', level: 'error', text: 'That folder does not exist.' }); break; } detach(); let w = this.workspaces.get(key); if (!w) { w = await Workspace.open(dir, !!m.demo, m.engine === 'codex' ? 'codex' : 'claude-code', m.resume); this.workspaces.set(key, w); } this.addRecent(dir); s.current = w; send({ t: 'opened', dir, history: w.history() }); s.leave = w.join(send); break; }
      case 'close': { if (s.current) { const w = s.current; detach(); w.close(); for (const [k, v] of this.workspaces) if (v === w) this.workspaces.delete(k); } send({ t: 'closed' }); break; }
      case 'submit': void s.current?.ctl.submit(m.text); break;
      case 'approve': s.current?.ctl.answerApproval(m.decision, m.scope ?? 'once'); break;
      case 'interrupt': void s.current?.ctl.interrupt(); break;
      case 'setModel': s.current?.ctl.setModel(m.id); break;
      case 'pref': await this.savePref(m); break;
      case 'cycleMode': s.current?.ctl.cycleMode(); break;
      case 'setMode': s.current?.ctl.setMode(m.mode); break;
      case 'models': { const list = await s.current?.ctl.engineModels(); send({ t: 'models', models: (list ?? []).map((x) => ({ id: x.id, label: x.label, note: x.note, efforts: x.efforts, defaultEffort: x.defaultEffort, isDefault: x.isDefault })) }); break; }
      case 'setEffort': if (!s.current?.ctl.setEffort(m.effort)) send({ t: 'notice', level: 'info', text: 'This agent has no reasoning effort setting.' }); break;
      case 'compact': void s.current?.ctl.submit('/compact'); break;
      case 'auto': s.current?.ctl.setSettings({ autoSkills: m.on }); break;
    }
  }
  /** On quit: settings are written and every agent session is stopped. */
  shutdown(): void { this.appCfg?.flush(); for (const w of this.workspaces.values()) w.close(); this.workspaces.clear(); }
}
