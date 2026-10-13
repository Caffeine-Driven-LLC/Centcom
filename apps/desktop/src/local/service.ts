/** The local session service: one per app. It is what the old localhost server did, minus the server: the app's screens talk to it over Electron IPC, so no port is opened and no token is needed. */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { CLAUDE_MODELS, CodexEngine, detectClaude, detectCodex, type ModelChoice } from '@centcom/agent';
import { ClientConfig, SessionStore } from '@centcom/tui';
import { Workspace } from './workspace.js';
import { CollabService, isCollabMsg, isJoinMsg, isShareMsg } from './collab.js';
import type { ClientMsg, DirEntry, Prefs, RecentDir, ServerMsg } from './protocol.js';

export const MAX_TEXT = 100_000; export const MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const;
export interface ServiceOptions { home?: string; stateDir?: string; cwd?: string; version?: string; /** Opens an address in the system browser (the sign-in page); `apiBase` is the configured API. Without it nothing is opened. */ openExternal?: (url: string, apiBase: string) => boolean; /** A seam for tests: the account the sign-in uses. */ makeAccount?: ConstructorParameters<typeof CollabService>[0]['makeAccount'] }
/** Reads a folder for the picker: no hidden folders, no node_modules, git folders first, at most 400 entries. */
export function listDir(path: string, home: string): { path: string; parent: string | null; git: boolean; entries: DirEntry[]; error?: string } {
  const p = resolve(path || home); const parent = dirname(p) === p ? null : dirname(p);
  try { const entries: DirEntry[] = []; for (const name of readdirSync(p)) { if (name.startsWith('.') || name === 'node_modules') continue; try { if (statSync(join(p, name)).isDirectory()) entries.push({ name, git: existsSync(join(p, name, '.git')) }); } catch { /* unreadable entry */ } } entries.sort((a, b) => Number(b.git) - Number(a.git) || a.name.localeCompare(b.name)); return { path: p, parent, git: existsSync(join(p, '.git')), entries: entries.slice(0, 400) }; }
  catch (e) { return { path: p, parent, git: false, entries: [], error: (e as NodeJS.ErrnoException).code === 'EACCES' ? 'No permission to read this folder.' : 'Cannot read this folder.' }; }
}
/** A message from a screen is trusted for nothing: the type is checked, text is capped, enums are matched. */
const ROLES = ['admin', 'member', 'billing', 'guest'] as const;
export function sanitise(raw: unknown): ClientMsg | undefined {
  if (!raw || typeof raw !== 'object' || typeof (raw as { t?: unknown }).t !== 'string') return undefined; const m = raw as Record<string, unknown>; const t = m.t as string;
  const str = (v: unknown, max = 4096): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined);
  switch (t) {
    case 'hello': case 'close': case 'leave': case 'interrupt': case 'cycleMode': return { t } as ClientMsg;
    case 'browse': { const p = str(m.path); return p === undefined ? undefined : { t, path: p }; }
    case 'open': { const dir = str(m.dir); if (!dir) return undefined; return { t, dir, demo: m.demo === true, engine: m.engine === 'codex' ? 'codex' : 'claude-code', ...(str(m.resume, 200) ? { resume: str(m.resume, 200) } : {}) }; }
    case 'pref': return { t, ...(m.theme === 'auto' || m.theme === 'dark' || m.theme === 'light' ? { theme: m.theme } : {}), ...(typeof m.side === 'boolean' ? { side: m.side } : {}) };
    case 'submit': { const text = str(m.text, MAX_TEXT * 2); return text === undefined ? undefined : { t, text: text.slice(0, MAX_TEXT) }; }
    case 'approve': return { t, decision: m.decision === 'approve' ? 'approve' : 'deny', ...(m.scope === 'session' || m.scope === 'always' ? { scope: m.scope } : {}) };
    case 'setModel': { const id = str(m.id, 200); return id === undefined ? undefined : { t, id }; }
    case 'setMode': return (MODES as readonly unknown[]).includes(m.mode) ? { t, mode: m.mode as (typeof MODES)[number] } : undefined;
    case 'models': case 'compact': case 'board': return { t } as ClientMsg;
    case 'note': { const text = str(m.text, 280); const type = m.type === 'warning' || m.type === 'finding' ? m.type : 'decision'; return text?.trim() ? { t, type, text: text.trim() } : undefined; }
    case 'notePin': { const id = str(m.id, 80); return id ? { t, id, pinned: m.pinned === true } : undefined; }
    case 'noteRemove': { const id = str(m.id, 80); return id ? { t, id } : undefined; }
    case 'setEffort': { const e = str(m.effort, 40); return e === undefined || !/^[\w-]*$/.test(e) ? undefined : { t, effort: e }; }
    case 'auto': return { t, on: m.on === true };
    case 'account': case 'login': case 'cancelLogin': case 'logout': case 'team': case 'upgrade': case 'share': case 'unshare': case 'shareLink': return { t } as ClientMsg;
    case 'shareInvite': { const e = str(m.email, 254); return { t, ...(e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? { email: e } : {}) } as ClientMsg; }
    case 'shareDecide': { const item = str(m.item, 80); return item && /^que_[0-9A-Za-z]+$/.test(item) ? { t, item, decision: m.decision === 'approve' ? 'approve' : 'reject' } : undefined; }
    case 'shareAuto': return { t, on: m.on === true } as ClientMsg;
    case 'join': { const input = str(m.input, 2048); return input?.trim() ? { t, input: input.trim() } : undefined; }
    case 'joinedAsk': { const text = str(m.text, 60_000); return text?.trim() ? { t, text } : undefined; }
    case 'joinedLeave': return { t } as ClientMsg;
    case 'teamInvite': { const email = str(m.email, 254)?.trim(); const role = ROLES.find((r) => r === m.role); return email && role ? { t, email, role } : undefined; }
    case 'teamRevoke': { const invite = str(m.invite, 80); return invite ? { t, invite } : undefined; }
    case 'teamRole': { const member = str(m.member, 80); const role = ROLES.find((r) => r === m.role); return member && role ? { t, member, role } : undefined; }
    case 'teamRemove': { const member = str(m.member, 80); return member ? { t, member } : undefined; }
    default: return undefined;
  }
}
export class LocalService {
  private readonly home: string; private readonly stateDir: string; private readonly cwd: string; private workspaces = new Map<string, Workspace>(); private appCfg?: ClientConfig; private warned = false;
  private sessions = new Map<unknown, { current?: Workspace; leave?: () => void; send(m: ServerMsg): void }>();
  private lastRunning = '';
  readonly collab: CollabService;
  private modelCache = new Map<string, ModelChoice[]>();
  /** Codex's models: from its running session in this folder, else a short-lived one that is stopped again (cached). */
  private async codexModels(dir: string): Promise<ModelChoice[]> {
    const live = await this.workspaces.get(`${dir}::codex`)?.ctl.engineModels(); if (live?.length) { this.modelCache.set('codex', live); return live; }
    const had = this.modelCache.get('codex'); if (had) return had;
    try { const sess = await new CodexEngine().start({ agentId: 'agt_models', cwd: dir }); try { const l = await (sess as unknown as { listModels?: () => Promise<ModelChoice[]> }).listModels?.() ?? []; if (l.length) this.modelCache.set('codex', l); return l; } finally { await sess.stop?.().catch(() => undefined); } } catch { return []; }
  }
  /** The menu's content: every installed agent's models (the shown agent's list is already known). */
  private async allModels(dir: string, shown: 'claude-code' | 'codex', mine: ModelChoice[]): Promise<Extract<ServerMsg, { t: 'engineModels' }>['engines']> {
    const [st, cx] = await Promise.all([detectClaude(), detectCodex()]); const out: Extract<ServerMsg, { t: 'engineModels' }>['engines'] = [];
    if (st.installed) out.push({ engine: 'claude-code', models: (shown === 'claude-code' ? mine : CLAUDE_MODELS.filter((x) => x.id)).map(row) });
    if (cx.installed) out.push({ engine: 'codex', models: (shown === 'codex' ? mine : await this.codexModels(dir)).map(row) });
    return out;
  }
  private runningMsg(): ServerMsg { return { t: 'running', sessions: [...this.workspaces.values()].map((w) => w.status()) }; }
  /** Tells every window which sessions are alive and what each one is doing, when that changed. */
  private broadcastRunning(): void { const m = this.runningMsg(); const j = JSON.stringify(m); if (j === this.lastRunning) return; this.lastRunning = j; for (const s of this.sessions.values()) s.send(m); }
  constructor(o: ServiceOptions = {}) { this.collab = new CollabService({ version: o.version ?? '0.1.0', broadcast: (m) => { for (const s of this.sessions.values()) s.send(m); }, toViewers: (ws, m) => { for (const s of this.sessions.values()) if (s.current === ws) s.send(m); }, openExternal: o.openExternal ?? (() => false), ...(o.makeAccount ? { makeAccount: o.makeAccount } : {}) }); this.home = o.home ?? homedir(); this.stateDir = o.stateDir ?? join(this.home, '.centcom'); this.cwd = o.cwd ?? this.home; mkdirSync(this.stateDir, { recursive: true, mode: 0o700 }); }
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
    const send = s.send; if (isCollabMsg(m)) { await this.collab.handle(m, send); return; } if (isJoinMsg(m)) { await this.collab.handleJoin(m, send, s.current && !s.current.demo ? s.current : undefined); return; } if (isShareMsg(m)) { await this.collab.handleShare(m, s.current, send); return; }
    switch (m.t) {
      case 'hello': { send(this.runningMsg()); this.collab.sendJoined(send); const [st, cx] = await Promise.all([detectClaude(), detectCodex()]); send({ t: 'launcher', home: this.home, cwd: this.cwd, recent: this.recent(), claude: { installed: st.installed, version: st.version, signedIn: st.signedIn, kind: st.loginKind }, codex: { installed: cx.installed, version: cx.version, signedIn: cx.signedIn, kind: cx.loginKind }, prefs: await this.prefs() }); if (this.appCfg && !this.warned) { this.warned = true; for (const w of this.appCfg.warnings) send({ t: 'notice', level: 'warn', text: 'Settings: ' + w }); } if (s.current) { const w = s.current.status(); send({ t: 'opened', dir: w.dir, history: s.current.history(), engine: w.engine, demo: w.demo }); } break; }
      case 'browse': { const d = listDir(m.path, this.home); send({ t: 'dir', ...d, saved: new SessionStore().list(d.path, 50).length }); break; }
      case 'open': { const dir = resolve(m.dir); const key = `${dir}::${m.demo ? 'demo' : m.engine ?? 'claude-code'}`; if (!existsSync(dir) || !statSync(dir).isDirectory()) { send({ t: 'notice', level: 'error', text: 'That folder does not exist.' }); break; } detach(); let w = this.workspaces.get(key); if (!w) { w = await Workspace.open(dir, !!m.demo, m.engine === 'codex' ? 'codex' : 'claude-code', m.resume); this.workspaces.set(key, w); w.onChange(() => this.broadcastRunning()); } this.addRecent(dir); s.current = w; send({ t: 'opened', dir, history: w.history(), engine: w.status().engine, demo: w.status().demo }); s.leave = w.join(send); this.collab.sendSharing(w, send); this.broadcastRunning(); break; }
      case 'leave': { detach(); send({ t: 'closed' }); break; }
      case 'close': { if (s.current) { const w = s.current; detach(); this.collab.stopSharing(w); w.close(); for (const [k, v] of this.workspaces) if (v === w) this.workspaces.delete(k); } send({ t: 'closed' }); this.broadcastRunning(); break; }
      case 'submit': void s.current?.ctl.submit(m.text); break;
      case 'approve': s.current?.ctl.answerApproval(m.decision, m.scope ?? 'once'); break;
      case 'interrupt': void s.current?.ctl.interrupt(); break;
      case 'setModel': s.current?.ctl.setModel(m.id); break;
      case 'pref': await this.savePref(m); break;
      case 'cycleMode': s.current?.ctl.cycleMode(); break;
      case 'setMode': s.current?.ctl.setMode(m.mode); break;
      case 'models': { const cur = s.current; const list = await cur?.ctl.engineModels(); const mine = list?.length ? list : cur?.which === 'claude-code' && !cur.demo ? CLAUDE_MODELS.filter((x) => x.id) : []; send({ t: 'models', models: mine.map(row) }); if (cur && !cur.demo) void this.allModels(cur.dir, cur.which, mine).then((engines) => send({ t: 'engineModels', engines })); break; }
      case 'setEffort': if (!s.current?.ctl.setEffort(m.effort)) send({ t: 'notice', level: 'info', text: 'This agent has no reasoning effort setting.' }); break;
      case 'compact': void s.current?.ctl.submit('/compact'); break;
      case 'board': send({ t: 'board', ...(s.current?.notes() ?? { enabled: false, notes: [] }) }); break;
      case 'note': void s.current?.ctl.submit(`/note ${m.type}: ${m.text}`); break;
      case 'notePin': s.current?.pinNote(m.id, m.pinned); break;
      case 'noteRemove': s.current?.removeNote(m.id); break;
      case 'auto': s.current?.ctl.setSettings({ autoSkills: m.on }); break;
    }
  }
  /** On quit: settings are written and every agent session is stopped. */
  shutdown(): void { void this.collab.leaveJoined(); this.appCfg?.flush(); for (const w of this.workspaces.values()) { this.collab.stopSharing(w); w.close(); } this.workspaces.clear(); this.lastRunning = ''; }
}

const row = (x: ModelChoice): { id: string; label: string; note: string; efforts?: string[]; defaultEffort?: string; isDefault?: boolean } => ({ id: x.id, label: x.label, note: x.note, efforts: x.efforts, defaultEffort: x.defaultEffort, isDefault: x.isDefault });
