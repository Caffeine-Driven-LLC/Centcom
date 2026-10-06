/**
 * Claude Code engine (lane C102): drives the user's own, unmodified `claude` binary, one `claude -p` process per
 * turn, continuing with --resume. Never reads credentials; auth is whatever the user's `claude` is signed in with.
 */
import { ApprovalBridge } from './bridge.js';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { AsyncQueue } from '../queue.js';
import { newId } from '../ids.js';
import { ClaudeStreamParser } from './parse.js';
import { ProviderError, type AgentEngine, type Capability, type EngineSession, type EngineStartOptions, type EventBody, type NormalisedEvent, type PermissionMode } from '../types.js';

export interface ClaudeEngineDeps { bin?: string; spawn?: typeof nodeSpawn; now?: () => Date }

const CAPS = new Set<Capability>(['streaming', 'approvals', 'resume', 'subagents', 'mcp', 'skills', 'thinking', 'usage', 'interrupt', 'compact', 'models.list']);

/** Strips things that look like credentials from text we may show or log (CT-PROVIDER rule 2). */
export function redact(s: string): string {
  return s.replace(/(?<![A-Za-z0-9_])sk-(ant-|proj-)?[A-Za-z0-9_-]{20,}/g, '[redacted]').replace(/([Aa]uthorization:\s*Bearer\s+)[A-Za-z0-9._-]{20,}/g, '$1[redacted]');
}

export class ClaudeCodeEngine implements AgentEngine {
  readonly id = 'claude-code' as const;
  readonly provider = 'anthropic' as const;
  readonly label = 'Claude Code';
  constructor(private deps: ClaudeEngineDeps = {}) {}
  capabilities() { return CAPS; }
  async start(o: EngineStartOptions): Promise<EngineSession> { return new ClaudeSession(o, this.deps); }
}

export function buildArgv(prompt: string, o: { resume?: string; permissionMode?: PermissionMode; model?: string; allowedTools?: string[]; systemPromptAppend?: string; addDirs?: string[]; extra?: string[] }): string[] {
  const a = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
  if (o.resume) a.push('--resume', o.resume);
  // 'default' is Centcom's "ask first"; say so explicitly, otherwise the user's own claude settings (e.g. defaultMode: auto) decide silently
  a.push('--permission-mode', !o.permissionMode || o.permissionMode === 'default' ? 'manual' : o.permissionMode);
  if (o.model) a.push('--model', o.model);
  if (o.allowedTools?.length) a.push('--allowedTools', ...o.allowedTools);
  if (o.systemPromptAppend) a.push('--append-system-prompt', o.systemPromptAppend);
  a.push(...(o.extra ?? []));
  for (const d of o.addDirs ?? []) a.push('--add-dir', d); // one flag per directory: the option is variadic and must not swallow later arguments
  return a;
}

class ClaudeSession implements EngineSession {
  readonly agentId: string;
  readonly events = new AsyncQueue<NormalisedEvent>();
  private seq = 0;
  private sessionId?: string;
  private child?: ChildProcess;
  private turn?: string;
  private mode: PermissionMode;
  private model?: string;
  private closed = false;
  private sawResult = false;
  private bridge?: ApprovalBridge;

  constructor(private o: EngineStartOptions, private deps: ClaudeEngineDeps) {
    this.agentId = o.agentId; this.sessionId = o.resume?.engine_session_id; this.mode = o.permissionMode ?? 'default'; this.model = o.model;
  }

  resumeToken() { return this.sessionId; }
  setModel(m: string) { this.model = m; }
  setPermissionMode(m: PermissionMode) { this.mode = m; }

  private emit(b: EventBody) {
    this.events.push({ ...b, v: 1, seq: ++this.seq, ts: (this.deps.now?.() ?? new Date()).toISOString(), agent_id: this.agentId, ...(this.turn ? { turn_id: this.turn } : {}) } as NormalisedEvent);
  }

  async send(prompt: string): Promise<{ turn_id: string }> {
    if (this.closed) throw new Error('session closed');
    if (this.child && !this.sawResult) throw new Error('a turn is already running');
    if (this.child) await this.exitWait; // the previous turn already reported its result; let the process finish exiting
    if (this.o.approvalGate && !this.bridge) { this.bridge = new ApprovalBridge({ agentId: this.agentId, cwd: this.o.cwd, gate: this.o.approvalGate, emit: (b) => this.emit(b) }); try { await this.bridge.start(); } catch (e) { this.bridge = undefined; this.emit({ type: 'engine.warning', code: 'approval_bridge_failed', text: `Approvals could not be bridged (${String(e)}). Claude will use its own permission mode.` }); } }
    const turn = newId('trn'); this.turn = turn; this.sawResult = false;
    this.emit({ type: 'turn.started', turn_id: turn });
    this.emit({ type: 'status', state: 'prompt-received' });
    const argv = buildArgv(prompt, { resume: this.sessionId, permissionMode: this.mode, model: this.model, allowedTools: this.o.allowedTools, systemPromptAppend: this.o.systemPromptAppend, addDirs: this.o.addDirs, extra: this.bridge?.argv() });
    const parser = new ClaudeStreamParser();
    const spawnFn = this.deps.spawn ?? nodeSpawn;
    let child: ChildProcess;
    try { child = spawnFn(this.deps.bin ?? 'claude', argv, { cwd: this.o.cwd, env: { ...process.env, ...this.o.env }, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { this.fail(e); return { turn_id: turn }; }
    this.child = child;
    this.exitWait = new Promise<void>((res) => { child.once('close', () => res()); child.once('error', () => res()); });
    let buf = ''; let err = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); this.handle(parser, line); }
      if (buf.length > 4 * 1024 * 1024) { buf = ''; this.emit({ type: 'engine.warning', code: 'line_too_long', text: 'Dropped an oversized line from Claude Code' }); }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (c: string) => { err = (err + c).slice(-64 * 1024); });
    child.on('error', (e: NodeJS.ErrnoException) => { this.child = undefined; this.fail(e); });
    child.on('close', (code, signal) => {
      if (buf.trim()) this.handle(parser, buf);
      this.child = undefined;
      if (this.sawResult) return;
      if (signal === 'SIGINT' || signal === 'SIGTERM' || this.interrupted) { this.interrupted = false; this.emit({ type: 'status', state: 'idle' }); this.emit({ type: 'turn.done', outcome: 'canceled' }); return; }
      const msg = redact(err.trim()).split('\n').slice(-4).join('\n') || `claude exited with code ${code}`;
      this.emit({ type: 'error', code: /not logged in|login/i.test(msg) ? 'provider_not_signed_in' : 'provider_protocol_error', tool_message: msg, fatal: true });
      this.emit({ type: 'status', state: 'error' });
      this.emit({ type: 'turn.done', outcome: 'error', stop_reason: String(code) });
    });
    return { turn_id: turn };
  }

  private interrupted = false;
  private exitWait: Promise<void> = Promise.resolve();

  private handle(parser: ClaudeStreamParser, line: string) {
    for (const b of parser.push(line)) {
      if (b.type === 'session.started') this.sessionId = b.engine_session_id || this.sessionId;
      if (b.type === 'turn.done') this.sawResult = true;
      if (b.type === 'error') b.tool_message = redact(b.tool_message);
      if (b.type === 'tool.result') b.summary = redact(b.summary);
      this.emit(b);
    }
  }

  private fail(e: unknown) {
    const code = (e as NodeJS.ErrnoException)?.code;
    const notInstalled = code === 'ENOENT';
    const err = new ProviderError(notInstalled ? 'provider_not_installed' : 'provider_protocol_error', 'claude-code', notInstalled ? 'Claude Code is not installed' : String(e));
    this.emit({ type: 'error', code: err.code, tool_message: notInstalled ? 'Could not find the `claude` command. Install Claude Code, sign in with `claude auth login`, then try again.' : redact(String(e)), fatal: true });
    this.emit({ type: 'status', state: 'error' });
    this.emit({ type: 'turn.done', outcome: 'error', stop_reason: String(code ?? 'spawn_failed') });
  }

  async interrupt(): Promise<{ stopped: boolean }> {
    const c = this.child;
    if (!c) return { stopped: false };
    this.interrupted = true;
    c.kill('SIGINT');
    const grace = this.o.limits?.interrupt_grace_ms ?? 3000;
    await new Promise<void>((res) => {
      const t = setTimeout(() => { c.kill('SIGTERM'); setTimeout(() => { c.kill('SIGKILL'); res(); }, 5000).unref(); }, grace);
      t.unref(); c.once('close', () => { clearTimeout(t); res(); });
    });
    return { stopped: true };
  }

  async stop() { this.closed = true; await this.interrupt(); this.bridge?.close(); this.events.close(); }
}
