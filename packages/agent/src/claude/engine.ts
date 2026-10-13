/**
 * Claude Code engine (lane C102): drives the user's own, unmodified `claude` binary, one `claude -p` process per
 * turn, continuing with --resume. Never reads credentials; auth is whatever the user's `claude` is signed in with.
 */
import { redact as redactSecrets } from '@centcom/protocol';
import { ApprovalBridge } from './bridge.js';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { signalLadder, type LadderClock } from '../interrupt/ladder.js';
import { sharedProcessRegistry, type Killed, type ProcessRegistry } from '../interrupt/procs.js';
import { EventSink, eventQueue } from '../backpressure.js';
import { newId } from '../ids.js';
import { ClaudeStreamParser } from './parse.js';
import { ProviderError, type AgentEngine, type Capability, type EngineSession, type EngineStartOptions, type EventBody, type NormalisedEvent, type PermissionMode } from '../types.js';

export interface ClaudeEngineDeps { bin?: string; spawn?: typeof nodeSpawn; now?: () => Date; /** Where engine pids are registered for the interrupt ladder (default: the app-wide one). */ procs?: ProcessRegistry; clock?: LadderClock }

/** Engine processes lead their own process group (not on Windows), so stopping one stops everything it started. */
const GROUPS = process.platform !== 'win32';
const CAPS = new Set<Capability>(['streaming', 'approvals', 'resume', 'subagents', 'mcp', 'skills', 'thinking', 'usage', 'interrupt', 'compact', 'models.list']);

/** Strips credentials from text we may show or log. The patterns are the contract's (CT-PROVIDER rule 1), shared with the rest of the client. */
export const redact = (s: string): string => redactSecrets(s);

export class ClaudeCodeEngine implements AgentEngine {
  readonly id = 'claude-code' as const;
  readonly provider = 'anthropic' as const;
  readonly label = 'Claude Code';
  constructor(private deps: ClaudeEngineDeps = {}) {}
  capabilities() { return CAPS; }
  async start(o: EngineStartOptions): Promise<EngineSession> { return new ClaudeSession(o, this.deps); }
}

/** `viaStdin`: the prompt is not on the command line (it would show in `ps`, and the system limits its size); `claude -p` then reads it from standard input. */
export function buildArgv(prompt: string, o: { viaStdin?: boolean; resume?: string; permissionMode?: PermissionMode; model?: string; effort?: string; allowedTools?: string[]; systemPromptAppend?: string; addDirs?: string[]; extra?: string[] }): string[] {
  const a = [...(o.viaStdin ? ['-p'] : ['-p', prompt]), '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
  if (o.resume) a.push('--resume', o.resume);
  // 'default' is Centcom's "ask first"; say so explicitly, otherwise the user's own claude settings (e.g. defaultMode: auto) decide silently
  a.push('--permission-mode', !o.permissionMode || o.permissionMode === 'default' ? 'manual' : o.permissionMode);
  if (o.model) a.push('--model', o.model);
  if (o.effort) a.push('--effort', o.effort);
  if (o.allowedTools?.length) a.push('--allowedTools', ...o.allowedTools);
  if (o.systemPromptAppend) a.push('--append-system-prompt', o.systemPromptAppend);
  a.push(...(o.extra ?? []));
  for (const d of o.addDirs ?? []) a.push('--add-dir', d); // one flag per directory: the option is variadic and must not swallow later arguments
  return a;
}

/** One JSONL line from the CLI may not exceed 1 MiB. */
export const MAX_LINE_BYTES = 1024 * 1024;

class ClaudeSession implements EngineSession {
  readonly agentId: string;
  readonly events = eventQueue();
  private sink = new EventSink(this.events);
  private seq = 0;
  private sessionId?: string;
  private child?: ChildProcess;
  private turn?: string;
  private mode: PermissionMode;
  private model?: string; private effort?: string;
  private closed = false;
  private sawResult = false;
  private bridge?: ApprovalBridge;

  constructor(private o: EngineStartOptions, private deps: ClaudeEngineDeps) {
    this.agentId = o.agentId; this.sessionId = o.resume?.engine_session_id; this.mode = o.permissionMode ?? 'default'; this.model = o.model;
  }

  resumeToken() { return this.sessionId; }
  setModel(m: string) { this.model = m; }
  setEffort(e: string) { this.effort = e || undefined; }
  setPermissionMode(m: PermissionMode) { this.mode = m; }

  private emit(b: EventBody) {
    this.sink.push(() => ({ ...b, v: 1, seq: ++this.seq, ts: (this.deps.now?.() ?? new Date()).toISOString(), agent_id: this.agentId, ...(this.turn ? { turn_id: this.turn } : {}) } as NormalisedEvent), () => { this.seq--; },
      (text) => this.emit({ type: 'engine.warning', code: 'events_dropped', text }));
  }

  async send(prompt: string): Promise<{ turn_id: string }> {
    if (this.closed) throw new Error('session closed');
    if (this.child && !this.sawResult) throw new Error('a turn is already running');
    if (this.child) await this.exitWait; // the previous turn already reported its result; let the process finish exiting
    if (this.o.approvalGate && !this.bridge) { this.bridge = new ApprovalBridge({ agentId: this.agentId, cwd: this.o.cwd, gate: this.o.approvalGate, emit: (b) => this.emit(b) }); try { await this.bridge.start(); } catch (e) { this.bridge = undefined; /* fail closed: never run Claude without Centcom's approvals */ const turn = newId('trn'); this.turn = turn; this.emit({ type: 'turn.started', turn_id: turn }); this.emit({ type: 'error', code: 'provider_protocol_error', tool_message: `Approvals could not be set up (${redact(String((e as Error)?.message ?? e))}), so nothing was run.`, fatal: false }); this.emit({ type: 'turn.done', outcome: 'error', stop_reason: 'approval_bridge_failed' }); return { turn_id: turn }; } }
    const turn = newId('trn'); this.turn = turn; this.sawResult = false;
    this.emit({ type: 'turn.started', turn_id: turn });
    this.emit({ type: 'status', state: 'prompt-received' });
    const argv = buildArgv(prompt, { viaStdin: true, resume: this.sessionId, permissionMode: this.mode, model: this.model, effort: this.effort, allowedTools: this.o.allowedTools, systemPromptAppend: this.o.systemPromptAppend, addDirs: this.o.addDirs, extra: this.bridge?.argv() });
    const parser = new ClaudeStreamParser();
    const spawnFn = this.deps.spawn ?? nodeSpawn;
    let child: ChildProcess;
    try { child = spawnFn(this.deps.bin ?? 'claude', argv, { cwd: this.o.cwd, env: this.o.envExact ? { ...this.o.env } : { ...process.env, ...this.o.env }, stdio: ['pipe', 'pipe', 'pipe'], detached: GROUPS }); }
    catch (e) { this.fail(e); return { turn_id: turn }; }
    child.stdin?.on('error', () => undefined); child.stdin?.end(prompt); // the prompt goes in over stdin, whole and unquoted
    this.child = child; const unreg = child.pid ? this.procs().register(this.agentId, child.pid, { group: GROUPS }) : () => undefined; // its own process group: tools and the approval helper go with it
    this.exitWait = new Promise<void>((res) => { child.once('close', () => { clearTimeout(firstTimer); unreg(); res(); }); child.once('error', () => { clearTimeout(firstTimer); unreg(); res(); }); });
    let buf = ''; let err = '';
    /** Nothing at all from the CLI within `first_event_timeout_ms` (30 s): it is hung (a dead network, a prompt waiting for a terminal). Stop it and say so. */
    let heard = false; const firstMs = this.o.limits?.first_event_timeout_ms ?? 30_000;
    const firstTimer = setTimeout(() => { if (heard || this.sawResult) return; this.sawResult = true; this.interrupted = false; for (const b of parser.closeOpen()) this.emit(b); try { if (child.pid && GROUPS) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* gone */ }
      this.emit({ type: 'error', code: 'provider_protocol_error', tool_message: `Claude Code did not start answering within ${Math.round(firstMs / 1000)} seconds, so the turn was stopped. Try again, or run \`claude\` yourself to see what it is waiting for.`, fatal: true });
      this.emit({ type: 'status', state: 'error' }); this.emit({ type: 'turn.done', outcome: 'error', stop_reason: 'first_event_timeout' }); }, firstMs); firstTimer.unref?.();
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (!heard) { heard = true; clearTimeout(firstTimer); }
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (Buffer.byteLength(line) > MAX_LINE_BYTES) return this.tooLong(child, parser); this.handle(parser, line); }
      if (Buffer.byteLength(buf) > MAX_LINE_BYTES) { buf = ''; this.tooLong(child, parser); }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (c: string) => { err = (err + c).slice(-64 * 1024); });
    child.on('error', (e: NodeJS.ErrnoException) => { this.child = undefined; this.fail(e); });
    child.on('close', (code, signal) => {
      if (buf.trim()) this.handle(parser, buf);
      this.child = undefined;
      if (this.sawResult) return;
      for (const b of parser.closeOpen()) this.emit(b);
      if (signal === 'SIGINT' || signal === 'SIGTERM' || this.interrupted) { this.interrupted = false; this.emit({ type: 'status', state: 'idle' }); this.emit({ type: 'turn.done', outcome: 'canceled' }); return; }
      const msg = redact(err.trim()).split('\n').slice(-4).join('\n') || `claude exited with code ${code}`;
      this.emit({ type: 'error', code: /not logged in|login/i.test(msg) ? 'provider_not_signed_in' : 'provider_protocol_error', tool_message: msg, fatal: true });
      this.emit({ type: 'status', state: 'error' });
      this.emit({ type: 'turn.done', outcome: 'error', stop_reason: String(code) });
    });
    return { turn_id: turn };
  }

  /** A line longer than the cap means the stream cannot be trusted any more: report it and stop the process. */
  private tooLong(child: ChildProcess, parser: ClaudeStreamParser) {
    if (this.sawResult) return; this.sawResult = true; child.kill('SIGKILL'); for (const b of parser.closeOpen()) this.emit(b);
    this.emit({ type: 'error', code: 'provider_protocol_error', tool_message: 'Claude Code sent a line that was too long to read, so the turn was stopped.', fatal: true });
    this.emit({ type: 'status', state: 'error' }); this.emit({ type: 'turn.done', outcome: 'error', stop_reason: 'line_too_long' });
  }

  signal(sig: 'SIGINT' | 'SIGTERM' | 'SIGKILL') { try { this.child?.kill(sig); } catch { /* already gone */ } }

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

  private procs(): ProcessRegistry { return this.deps.procs ?? sharedProcessRegistry(); }
  /** SIGINT ends Claude's turn; it gets 3 s, then SIGTERM, then SIGKILL at 8 s, each to its whole process group. `hard` kills at once. */
  async interrupt(o: { hard?: boolean } = {}): Promise<{ stopped: boolean; method?: 'sigint'; terminated?: Killed[] }> {
    const c = this.child;
    if (!c || this.sawResult) return { stopped: false };
    this.interrupted = true;
    if (!c.pid) { c.kill(o.hard ? 'SIGKILL' : 'SIGINT'); await this.exitWait; return { stopped: true, method: 'sigint', terminated: [] }; }
    const r = await signalLadder({ agentId: this.agentId, procs: this.procs(), exited: this.exitWait, graceMs: this.o.limits?.interrupt_grace_ms ?? 3000, hard: o.hard, clock: this.deps.clock });
    return { stopped: true, method: 'sigint', terminated: r.terminated };
  }

  async stop() { this.closed = true; await this.interrupt(); this.bridge?.close(); this.events.close(); }
}
