/** Drives the user's own `codex` CLI through `codex app-server` (JSON-RPC over stdio). Centcom never touches Codex credentials. */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { signalLadder, type LadderClock } from '../interrupt/ladder.js';
import { sharedProcessRegistry, type Killed, type ProcessRegistry } from '../interrupt/procs.js';
import { newId } from '../ids.js';
import { AsyncQueue } from '../queue.js';
import type { AgentEngine, ApprovalDecision, Capability, EngineSession, EngineStartOptions, EventBody, LoginKind, NormalisedEvent, PermissionMode } from '../types.js';
import { ProviderError } from '../types.js';
import { redact } from '../claude/engine.js';
import { CodexMapper } from './map.js';
import { RpcClient } from './rpc.js';
import { killThreadCommands } from './threadprocs.js';
import type { ModelChoice } from '../models.js';

const CAPS = new Set<Capability>(['streaming', 'approvals', 'resume', 'mcp', 'thinking', 'usage', 'interrupt', 'compact', 'models.list']);

export interface CodexEngineDeps { stallMs?: number; killCommands?: (threadId: string, self: number[]) => Promise<number[]>; bin?: string; spawn?: typeof nodeSpawn; now?: () => Date; env?: Record<string, string | undefined>; procs?: ProcessRegistry; clock?: LadderClock }
/** The app-server leads its own process group (not on Windows), so stopping it stops the commands it started. */
const GROUPS = process.platform !== 'win32';

/** Centcom's four permission modes as Codex approval policy + sandbox. */
export function policyFor(mode: PermissionMode): { approvalPolicy: string; sandboxPolicy: { type: string } } {
  switch (mode) {
    case 'acceptEdits': return { approvalPolicy: 'on-request', sandboxPolicy: { type: 'workspaceWrite' } };
    case 'plan': return { approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly' } };
    case 'bypassPermissions': return { approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } };
    default: return { approvalPolicy: 'untrusted', sandboxPolicy: { type: 'workspaceWrite' } }; // ask first
  }
}
/** Commands must not see Centcom's own tokens or anyone's keys: Codex passes its whole environment to them by default. */
export const ENV_EXCLUDE = ['CENTCOM_*', '*TOKEN*', '*SECRET*', '*KEY*', '*PASSWORD*'];
export const MIN_CODEX = [0, 161, 0] as const;
/** A note when the Codex that answered is older than the version this adapter was verified against (or a new major). */
export function versionNote(userAgent: unknown): string | undefined {
  const m = /\/(\d+)\.(\d+)\.(\d+)/.exec(String(userAgent ?? '')); if (!m) return undefined; const v = [Number(m[1]), Number(m[2]), Number(m[3])];
  const older = v[0]! < MIN_CODEX[0] || (v[0] === MIN_CODEX[0] && (v[1]! < MIN_CODEX[1] || (v[1] === MIN_CODEX[1] && v[2]! < MIN_CODEX[2])));
  if (older) return `Codex ${v.join('.')} is older than 0.161.0, the version Centcom was checked against. Update Codex (npm i -g @openai/codex) if something misbehaves.`;
  if (v[0]! >= 1) return `Codex ${v.join('.')} is newer than anything Centcom was checked against; some details may differ.`;
  return undefined;
}
export function loginKindFromAccount(a: { type?: string } | null | undefined): LoginKind {
  if (!a) return 'unknown'; if (a.type === 'chatgpt') return 'subscription'; if (a.type === 'apiKey') return 'api_key'; if (a.type === 'amazonBedrock') return 'cloud'; return 'unknown';
}

export class CodexEngine implements AgentEngine {
  readonly id = 'codex' as const; readonly provider = 'openai' as const; readonly label = 'Codex';
  constructor(private deps: CodexEngineDeps = {}) {}
  capabilities() { return CAPS; }
  async start(o: EngineStartOptions): Promise<EngineSession> { const s = new CodexSession(o, this.deps); await s.init(); return s; }
}

class CodexSession implements EngineSession {
  readonly agentId: string;
  readonly events = new AsyncQueue<NormalisedEvent>();
  private seq = 0; private turn?: string; private codexTurn?: string; private threadId?: string;
  private rpc?: RpcClient; private child?: ChildProcess;
  private mapper = new CodexMapper();
  private mode: PermissionMode; private model?: string;
  private signedIn = false; private ready = false; private closed = false; private running = false; private interrupted = false;
  private turnDone?: () => void;
  private exitedResolve!: (v: { code?: number; signal?: string }) => void;
  readonly exited = new Promise<{ code?: number; signal?: string }>((res) => { this.exitedResolve = res; });
  signal(sig: 'SIGINT' | 'SIGTERM' | 'SIGKILL') { try { this.child?.kill(sig); } catch { /* already gone */ } }

  constructor(private o: EngineStartOptions, private deps: CodexEngineDeps) { this.agentId = o.agentId; this.mode = o.permissionMode ?? 'default'; this.model = o.model; }
  resumeToken() { return this.threadId; }
  setModel(m: string) { this.model = m || undefined; }
  setPermissionMode(m: PermissionMode) { this.mode = m; }

  private emit(b: EventBody) { this.events.push({ ...b, v: 1, seq: ++this.seq, ts: (this.deps.now?.() ?? new Date()).toISOString(), agent_id: this.agentId, ...(this.turn ? { turn_id: this.turn } : {}) } as NormalisedEvent); }

  async init() {
    const spawnFn = this.deps.spawn ?? nodeSpawn;
    let child: ChildProcess;
    try { child = spawnFn(this.deps.bin ?? 'codex', ['app-server', '--listen', 'stdio://'], { cwd: this.o.cwd, env: this.o.envExact ? { ...this.o.env } : { ...process.env, ...this.deps.env, ...this.o.env }, stdio: ['pipe', 'pipe', 'pipe'], detached: GROUPS }); }
    catch (e) { return this.fail(e); }
    this.child = child; const unreg = child.pid ? this.procs().register(this.agentId, child.pid, { group: GROUPS }) : () => undefined;
    this.childExit = new Promise<void>((res) => { child.once('close', () => { unreg(); res(); }); child.once('error', () => { unreg(); res(); }); });
    let err = ''; child.stderr?.setEncoding('utf8'); child.stderr?.on('data', (c: string) => { err = (err + c).slice(-8192); });
    child.on('error', (e) => this.fail(e));
    const rpc = this.rpc = new RpcClient(child);
    rpc.onLineTooLong = () => { this.emit({ type: 'error', code: 'provider_protocol_error', tool_message: 'Codex sent a line that was too long to read, so the session was stopped.', fatal: true }); this.emit({ type: 'status', state: 'error' }); this.signal('SIGKILL'); };
    rpc.onNotification = (m, p) => this.onNotification(m, p);
    rpc.onServerRequest = (id, m, p) => void this.onServerRequest(id, m, p);
    rpc.onClose = (code) => { this.ready = false; if (this.killed) return; /* we stopped it ourselves; the next message starts it again */ if (!this.closed) this.exitedResolve(code === null ? { signal: 'unknown' } : { code }); if (this.running && !this.closed) { this.emit({ type: 'error', code: 'provider_protocol_error', tool_message: redact(err.trim().split('\n').slice(-3).join('\n')) || `codex exited with code ${code}`, fatal: true }); this.finishTurn('error'); } };
    try {
      const hello = await rpc.request('initialize', { clientInfo: { name: 'centcom', title: 'Centcom', version: '0.1.0' } }, 20_000); this.versionWarning = versionNote(hello?.userAgent);
      rpc.notify('initialized');
      const acc = await rpc.request('account/read', { refreshToken: false }, 15_000);
      this.signedIn = !!acc?.account; const login = loginKindFromAccount(acc?.account);
      const pol = policyFor(this.mode);
      const sandbox = ({ readOnly: 'read-only', workspaceWrite: 'workspace-write', dangerFullAccess: 'danger-full-access' } as Record<string, string>)[pol.sandboxPolicy.type];
      // No `sandbox` here: on 0.161.0 a thread/start with workspace-write marks the folder trusted in ~/.codex/config.toml, which lets a repo's own MCP servers and hooks run. The sandbox is passed on every turn instead.
      const params = { cwd: this.o.cwd, approvalPolicy: pol.approvalPolicy, config: { shell_environment_policy: { inherit: 'all', exclude: ENV_EXCLUDE } }, ...(this.model ? { model: this.model } : {}), ...(this.o.systemPromptAppend ? { developerInstructions: this.o.systemPromptAppend } : {}) };
      const r = this.o.resume?.engine_session_id ? await rpc.request('thread/resume', { threadId: this.o.resume.engine_session_id, excludeTurns: true, ...params }, 30_000) : await rpc.request('thread/start', params, 30_000);
      this.threadId = r.thread?.id; this.ready = true;
      this.emit({ type: 'session.started', engine: 'codex', engine_session_id: this.threadId ?? '', model: r.model ?? this.model ?? 'codex', tools: ['shell', 'apply_patch'], mcp_servers: [], capabilities: [...CAPS], login_kind: login });
      if (this.versionWarning) this.emit({ type: 'engine.warning', code: 'codex_version', text: this.versionWarning });
      if (!this.signedIn) this.emit({ type: 'engine.warning', code: 'provider_not_signed_in', text: 'Codex is not signed in, or the login has expired. Run `codex login`, then send your message again.' });
    } catch (e) {
      const hint = redact(err.trim().split('\n').slice(-2).join('\n'));
      this.fail(e, hint);
    }
  }

  private fail(e: unknown, hint = '') {
    const notInstalled = (e as NodeJS.ErrnoException)?.code === 'ENOENT';
    const perr = new ProviderError(notInstalled ? 'provider_not_installed' : 'provider_protocol_error', 'codex', notInstalled ? 'Codex is not installed' : String(e));
    this.emit({ type: 'error', code: perr.code, tool_message: notInstalled ? 'Could not find the `codex` command. Install Codex (npm i -g @openai/codex), sign in with `codex login`, then try again.' : redact(`${String((e as Error)?.message ?? e)} ${hint}`.trim()), fatal: true });
    this.emit({ type: 'status', state: 'error' });
  }

  async send(prompt: string): Promise<{ turn_id: string }> {
    if (this.closed) throw new Error('session closed');
    if (this.running) throw new Error('a turn is already running');
    const turn = newId('trn'); this.turn = turn;
    this.emit({ type: 'turn.started', turn_id: turn }); this.emit({ type: 'status', state: 'prompt-received' });
    if ((this.killed || !this.ready) && !this.closed && this.threadId) { this.killed = false; this.o = { ...this.o, resume: { engine_session_id: this.threadId } }; this.turn = undefined; await this.init(); this.turn = turn; } // stopped by the ladder last time: start again on the same thread
    if (!this.ready || !this.rpc || !this.threadId) { this.emit({ type: 'status', state: 'error' }); this.emit({ type: 'turn.done', outcome: 'error', stop_reason: 'not_ready' }); return { turn_id: turn }; }
    if (!this.signedIn) {
      this.emit({ type: 'error', code: 'provider_not_signed_in', tool_message: 'Codex is not signed in, or the login has expired. Run `codex login` in a terminal, then try again.', fatal: true });
      this.emit({ type: 'status', state: 'error' }); this.emit({ type: 'turn.done', outcome: 'error', stop_reason: 'not_signed_in' }); return { turn_id: turn };
    }
    this.running = true; this.interrupted = false; this.codexTurn = undefined; this.watchStall();
    const done = new Promise<void>((res) => { this.turnDone = res; });
    try {
      const r = await this.rpc.request('turn/start', { threadId: this.threadId, input: [{ type: 'text', text: prompt }], ...(this.model ? { model: this.model } : {}), ...policyFor(this.mode) }, 30_000);
      this.codexTurn = r.turn?.id;
    } catch (e) {
      this.emit({ type: 'error', code: 'provider_protocol_error', tool_message: redact(String((e as Error).message ?? e)), fatal: true }); this.finishTurn('error'); return { turn_id: turn };
    }
    void done; return { turn_id: turn };
  }

  /** A turn once sat silent for 3 minutes on a real Codex; say so instead of looking frozen. */
  private watchStall() {
    const limit = this.deps.stallMs ?? 120_000; if (!limit) return; this.lastActivity = Date.now(); this.stallWarned = false; clearInterval(this.stallTimer);
    this.stallTimer = setInterval(() => { if (!this.running) { clearInterval(this.stallTimer); return; } if (!this.stallWarned && Date.now() - this.lastActivity >= limit) { this.stallWarned = true; this.emit({ type: 'engine.warning', code: 'codex_stalled', text: `Codex has sent nothing for ${Math.round(limit / 1000)} seconds. It may still be working; press Stop to cancel.` }); } }, Math.max(10, Math.min(5000, limit / 4)));
    this.stallTimer.unref?.();
  }

  private finishTurn(outcome: 'ok' | 'error' | 'canceled') {
    if (!this.running) return;
    this.running = false; clearInterval(this.stallTimer); this.emit({ type: 'status', state: outcome === 'error' ? 'error' : 'idle' }); this.emit({ type: 'turn.done', outcome }); this.turnDone?.();
  }

  private onNotification(method: string, p: any) {
    this.lastActivity = Date.now(); this.stallWarned = false;
    if (p?.turnId && this.codexTurn && p.turnId !== this.codexTurn && method !== 'account/rateLimits/updated') return; // another turn (e.g. a sub-thread)
    const evs = this.mapper.notification(method, p ?? {});
    for (const b of evs) {
      if (b.type === 'turn.done') { if (!this.running) continue; this.running = false; this.turnDone?.(); }
      if (b.type === 'error') b.tool_message = redact(b.tool_message);
      if (b.type === 'tool.result') b.summary = redact(b.summary);
      this.emit(b);
    }
  }

  private async onServerRequest(id: number | string, method: string, p: any) {
    if (method !== 'item/commandExecution/requestApproval' && method !== 'item/fileChange/requestApproval') {
      // anything else (user-input, MCP elicitation, token refresh, legacy approvals): decline rather than hang the turn
      this.rpc?.respondError(id, -32601, `Centcom does not handle ${method}`);
      this.emit({ type: 'engine.warning', code: 'unhandled_server_request', text: `Codex asked for ${method}, which Centcom does not support yet. It was declined.` });
      return;
    }
    const info = this.mapper.approval(method, p ?? {});
    const approval = { approval_id: newId('apr'), agent_id: this.agentId, tool_id: info.tool_id, tool: info.tool, summary: info.summary, risk: info.risk, ...(info.cwd ? { cwd: info.cwd } : {}), ...(info.command ? { command: info.command } : {}), ...(info.path ? { path: info.path } : {}), ...(info.diff ? { diff: info.diff } : {}) };
    this.emit({ type: 'approval.requested', approval_id: approval.approval_id, tool_id: approval.tool_id, summary: `${approval.tool}: ${approval.summary}`, risk: approval.risk, ...(approval.command ? { command: approval.command } : {}), ...(approval.cwd ? { cwd: approval.cwd } : {}), ...(approval.diff ? { diff: approval.diff } : {}), ...(approval.path ? { path: approval.path } : {}) });
    this.emit({ type: 'status', state: 'awaiting-approval' });
    let d: ApprovalDecision;
    try { d = this.o.approvalGate ? await this.o.approvalGate.decide(approval) : { decision: 'deny', scope: 'once', reason: 'no approval gate' }; } catch { d = { decision: 'deny', scope: 'once', reason: 'error' }; }
    this.emit({ type: 'approval.resolved', approval_id: approval.approval_id, decision: d.decision, scope: d.scope, by: d.reason === 'interrupt' ? 'interrupt' : 'user' });
    const decision = d.decision === 'approve' ? (d.scope === 'once' ? 'accept' : 'acceptForSession') : d.reason === 'interrupt' ? 'cancel' : 'decline';
    this.rpc?.respond(id, { decision });
  }

  private versionWarning?: string; private lastActivity = 0; private stallTimer?: ReturnType<typeof setInterval>; private stallWarned = false;
  private childExit: Promise<void> = Promise.resolve(); private killed = false;
  private procs(): ProcessRegistry { return this.deps.procs ?? sharedProcessRegistry(); }
  /** `turn/interrupt` first; if Codex does not finish the turn within the grace time (3 s), the signal ladder stops the app-server, and the next message starts it again on the same thread. */
  async interrupt(o: { hard?: boolean } = {}): Promise<{ stopped: boolean; method?: 'protocol' | 'sigint'; terminated?: Killed[] }> {
    if (!this.running || !this.rpc || !this.threadId) return { stopped: false };
    this.interrupted = true; const grace = this.o.limits?.interrupt_grace_ms ?? 3000; const clock = this.deps.clock ?? { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms).unref(), clearTimeout: (h: unknown) => clearTimeout(h as NodeJS.Timeout) };
    if (!o.hard) {
      const finished = new Promise<boolean>((res) => { const prev = this.turnDone; this.turnDone = () => { prev?.(); res(true); }; const h = clock.setTimeout(() => res(false), grace); void this.childExit.then(() => { clock.clearTimeout(h); res(true); }); });
      try { if (this.codexTurn) void this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.codexTurn }, grace).catch(() => undefined); } catch { /* the ladder below handles it */ }
      if (await finished) { if (this.running) this.finishTurn('canceled'); await this.stopCommands(); return { stopped: true, method: 'protocol', terminated: [] }; }
    }
    this.killed = true; const child = this.child;
    const r = child?.pid ? await signalLadder({ agentId: this.agentId, procs: this.procs(), exited: this.childExit, graceMs: grace, hard: o.hard, clock }) : { terminated: [] };
    if (!child?.pid) { try { child?.kill('SIGKILL'); } catch { /* gone */ } }
    this.ready = false; if (this.running) this.finishTurn('canceled'); await this.stopCommands();
    return { stopped: true, method: 'sigint', terminated: r.terminated };
  }

  /** `turn/interrupt` ends the turn but not the commands it started (they run in another process group): stop them by their thread tag. */
  private async stopCommands() { if (!this.threadId) return; try { await (this.deps.killCommands ?? ((t, self) => killThreadCommands(t, { self })))(this.threadId, this.child?.pid ? [this.child.pid] : []); } catch { /* best effort */ } }

  /** Models the signed-in account can use (model/list). */
  async listModels(): Promise<ModelChoice[]> {
    if (!this.rpc || !this.ready) return [];
    const r = await this.rpc.request('model/list', {}, 15_000);
    return (r.data ?? []).filter((m: any) => !m.hidden).map((m: any): ModelChoice => ({ id: m.model, label: m.displayName ?? m.model, note: String(m.description ?? '').slice(0, 80), provider: 'openai' }));
  }

  async stop() {
    this.closed = true; await this.interrupt();
    this.rpc?.closed || this.child?.kill('SIGTERM'); this.events.close();
  }
}
