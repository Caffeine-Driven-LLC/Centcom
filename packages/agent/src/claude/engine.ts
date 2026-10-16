/**
 * Claude Code engine (lane C102): drives the user's own, unmodified `claude` binary, one `claude -p` process per
 * turn, continuing with --resume. Never reads credentials; auth is whatever the user's `claude` is signed in with.
 */
import { redact as redactSecrets } from '@centcom/protocol';
import { ApprovalBridge, SUBAGENT_TOOLS } from './bridge.js';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { realClock, signalLadder, type LadderClock } from '../interrupt/ladder.js';
import { sharedProcessRegistry, type Killed, type ProcessRegistry } from '../interrupt/procs.js';
import { EventSink, eventQueue } from '../backpressure.js';
import { newId } from '../ids.js';
import { rangeFor } from '../provider/detect/ranges.js';
import { rangePosition } from '../provider/detect/semver.js';
import { runProbe } from '../provider/detect/probe.js';
import { providerMessage } from '../provider/messages.js';
import { ClaudeStreamParser } from './parse.js';
import { CLAUDE_MODELS, type ModelChoice } from '../models.js';
import { INITIALIZE_REQUEST, MODELS_QUERY_ARGS, effortsFor, fallbackModels, parseInitializeModels, type ClaudeModel } from './models.js';
import { ProviderError, type AgentEngine, type Capability, type EngineSession, type EngineStartOptions, type EventBody, type NormalisedEvent, type PermissionMode } from '../types.js';

export interface ClaudeEngineDeps { /** Reads `claude --version` before the first turn; with it the engine refuses a version outside the supported range (`provider_version_unsupported`) unless `unsupportedOk`. */ versionProbe?: () => Promise<string | undefined>; unsupportedOk?: boolean; bin?: string; spawn?: typeof nodeSpawn; now?: () => Date; /** Where engine pids are registered for the interrupt ladder (default: the app-wide one). */ procs?: ProcessRegistry; clock?: LadderClock }

/** Engine processes lead their own process group (not on Windows), so stopping one stops everything it started. */
const GROUPS = process.platform !== 'win32';
const CAPS = new Set<Capability>(['streaming', 'approvals', 'resume', 'subagents', 'mcp', 'skills', 'thinking', 'usage', 'interrupt', 'compact', 'models.list']);

/** Strips credentials from text we may show or log. The patterns are the contract's (CT-PROVIDER rule 1), shared with the rest of the client. */
export const redact = (s: string): string => redactSecrets(s);

/** `claude --version`, read once and bounded (3 s, 4 KiB); undefined when it cannot be read (the check then lets the turn go on: the app's own start-up check already said what it could). */
export const claudeVersionProbe = (bin = 'claude'): (() => Promise<string | undefined>) => async () => { const r = await runProbe(bin, ['--version'], { timeoutMs: 3000, maxBytes: 4096 }); return r.missing || r.timedOut || r.code !== 0 ? undefined : r.out.trim().slice(0, 100); };

export class ClaudeCodeEngine implements AgentEngine {
  readonly id = 'claude-code' as const;
  readonly provider = 'anthropic' as const;
  readonly label = 'Claude Code';
  constructor(private deps: ClaudeEngineDeps = {}) {}
  capabilities() { return CAPS; }
  async start(o: EngineStartOptions): Promise<EngineSession> { return new ClaudeSession(o, this.deps); }
}

/** `viaStdin`: the prompt is not on the command line (it would show in `ps`, and the system limits its size); `claude -p` then reads it from standard input. */
export function buildArgv(prompt: string, o: { viaStdin?: boolean; /** The prompt and later control requests go in as stream-json lines (`--input-format stream-json`); needs `viaStdin`. */ streamInput?: boolean; resume?: string; permissionMode?: PermissionMode; model?: string; effort?: string; allowedTools?: string[]; systemPromptAppend?: string; addDirs?: string[]; extra?: string[]; disallowedTools?: string[]; /** The engine's own cap on what this turn may cost (`--max-budget-usd`). */ maxBudgetUsd?: number }): string[] {
  const a = [...(o.viaStdin ? ['-p', ...(o.streamInput ? ['--input-format', 'stream-json'] : [])] : ['-p', prompt]), '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
  if (o.resume) a.push('--resume', o.resume);
  // 'default' is Centcom's "ask first"; say so explicitly, otherwise the user's own claude settings (e.g. defaultMode: auto) decide silently
  a.push('--permission-mode', !o.permissionMode || o.permissionMode === 'default' ? 'manual' : o.permissionMode);
  if (o.model) a.push('--model', o.model);
  if (o.effort) a.push('--effort', o.effort);
  if (o.allowedTools?.length) a.push('--allowedTools', ...o.allowedTools);
  if (o.disallowedTools?.length) a.push('--disallowedTools', ...o.disallowedTools);
  if (o.maxBudgetUsd && o.maxBudgetUsd > 0) a.push('--max-budget-usd', o.maxBudgetUsd.toFixed(2));
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
    this.agentId = o.agentId; this.sessionId = o.resume?.engine_session_id; this.carryPending = !!o.carryOver && !o.resume; this.mode = o.permissionMode ?? 'default'; this.model = o.model; this.effort = o.effort || undefined;
    if (this.mode === 'bypassPermissions' && !o.allowBypass) { this.mode = 'default'; this.bypassRefused = true; } // never skip approvals because a default said so: the person has to have asked
  }
  /** The carry-over goes in front of the first message of a session that has nothing to resume, once. */
  private carryPending = false;
  private bypassRefused = false; private versionAllowed?: boolean;

  /** The child's environment: as configured, plus the sub-agent model when one is set and the person has not set their own. */
  private childEnv(): NodeJS.ProcessEnv {
    const base = this.o.envExact ? { ...this.o.env } : { ...process.env, ...this.o.env };
    if (this.o.subagentModel && !base.CLAUDE_CODE_SUBAGENT_MODEL) base.CLAUDE_CODE_SUBAGENT_MODEL = this.o.subagentModel;
    return base;
  }
  resumeToken() { return this.sessionId; }
  private limits: { noSubagents?: boolean; maxBudgetUsd?: number } = {};
  setTurnLimits(l: { noSubagents?: boolean; maxBudgetUsd?: number }) { this.limits = { ...l }; }
  setModel(m: string) { this.model = m; }
  private models?: Promise<ClaudeModel[]>;
  /**
   * The models Claude Code lists, with the effort levels each takes: the answer to the free `initialize` control request (no prompt is sent),
   * asked once per session and kept. If the query fails (no `claude`, no answer within 15 s) it is the static list with assumed levels, FALLBACK ONLY.
   */
  listModels(): Promise<ModelChoice[]> { return (this.models ??= this.queryModels()); }
  private queryModels(): Promise<ClaudeModel[]> {
    const fallback = () => fallbackModels(CLAUDE_MODELS.filter((m) => m.id));
    return new Promise<ClaudeModel[]>((resolve) => {
      let done = false; let child: ChildProcess | undefined; let buf = '';
      const finish = (l: ClaudeModel[] | undefined) => { if (done) return; done = true; clearTimeout(timer); try { child?.stdin?.end(); } catch { /* gone */ } try { child?.kill('SIGTERM'); } catch { /* gone */ } resolve(l ?? fallback()); };
      const timer = setTimeout(() => finish(undefined), this.o.limits?.models_timeout_ms ?? 15_000); timer.unref?.();
      try {
        child = (this.deps.spawn ?? nodeSpawn)(this.deps.bin ?? 'claude', [...MODELS_QUERY_ARGS], { cwd: this.o.cwd, env: this.childEnv(), stdio: ['pipe', 'pipe', 'ignore'] });
        child.on('error', () => finish(undefined)); child.on('close', () => finish(undefined));
        child.stdin?.on('error', () => undefined); child.stdin?.write(INITIALIZE_REQUEST + '\n');
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (c: string) => { buf += c; let i: number; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.includes('"control_response"')) { const l = parseInitializeModels(line); if (l || line.includes('centcom_init')) return finish(l); } } if (buf.length > 4 * MAX_LINE_BYTES) buf = ''; });
      } catch { finish(undefined); }
    });
  }
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
    if (this.o.approvalGate && !this.bridge) { this.bridge = new ApprovalBridge({ agentId: this.agentId, cwd: this.o.cwd, gate: this.o.approvalGate, emit: (b) => this.emit(b), ...(this.o.subagentGate ? { subagentGate: this.o.subagentGate } : {}) }); try { await this.bridge.start(); } catch (e) { this.bridge = undefined; /* fail closed: never run Claude without Centcom's approvals */ const turn = newId('trn'); this.turn = turn; this.emit({ type: 'turn.started', turn_id: turn }); this.emit({ type: 'error', code: 'provider_protocol_error', tool_message: `Approvals could not be set up (${redact(String((e as Error)?.message ?? e))}), so nothing was run.`, fatal: false }); this.emit({ type: 'turn.done', outcome: 'error', stop_reason: 'approval_bridge_failed' }); return { turn_id: turn }; } }
    const turn = newId('trn'); this.turn = turn; this.sawResult = false; this.interrupted = false;
    this.emit({ type: 'turn.started', turn_id: turn });
    if (this.bypassRefused) { this.bypassRefused = false; this.emit({ type: 'engine.warning', code: 'bypass_not_allowed', text: 'Approvals stay on: skipping them has to be asked for (/mode bypass, or --dangerously-skip-permissions).' }); }
    if (!(await this.versionOk())) return { turn_id: turn };
    this.emit({ type: 'status', state: 'prompt-received' });
    let effort = this.effort; // never sent to a model that has no effort setting, nor at a level it does not take
    if (effort) { let levels: string[]; try { levels = effortsFor((await this.listModels()) as ClaudeModel[], this.model); } catch { levels = []; } if (!levels.includes(effort)) { this.emit({ type: 'engine.warning', code: 'effort_not_supported', text: levels.length ? `${this.model || 'This model'} does not take effort ${effort}, so none was set.` : `${this.model || 'This model'} has no effort setting, so none was set.` }); effort = undefined; } }
    const argv = buildArgv(prompt, { viaStdin: true, streamInput: true, resume: this.sessionId, permissionMode: this.mode, model: this.model, effort, allowedTools: this.o.allowedTools, disallowedTools: this.limits.noSubagents ? [...SUBAGENT_TOOLS] : undefined, maxBudgetUsd: this.limits.maxBudgetUsd, systemPromptAppend: this.o.systemPromptAppend, addDirs: this.o.addDirs, extra: this.bridge?.argv() });
    const parser = new ClaudeStreamParser(); this.parser = parser; this.receiptCap = false;
    const spawnFn = this.deps.spawn ?? nodeSpawn;
    let child: ChildProcess;
    try { child = spawnFn(this.deps.bin ?? 'claude', argv, { cwd: this.o.cwd, env: this.childEnv(), stdio: ['pipe', 'pipe', 'pipe'], detached: GROUPS }); }
    catch (e) { this.fail(e); return { turn_id: turn }; }
    child.stdin?.on('error', () => undefined); child.stdin?.write(JSON.stringify({ type: 'user', message: { role: 'user', content: this.carryPending && this.o.carryOver ? `${this.o.carryOver}\n\n${prompt}` : prompt } }) + '\n'); // the prompt goes in over stdin as one stream-json message (never on the command line); stdin stays open for a control request until the turn is over
    this.carryPending = false;
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

  /** Before the first turn: is this `claude` a version Centcom has been checked against? Says so and ends the turn when it is not. */
  private async versionOk(): Promise<boolean> {
    const probe = this.deps.versionProbe; if (!probe) return true;
    if (this.versionAllowed === undefined) { // read once per session; a refusal stays, so the next prompt is refused too
      let v: string | undefined; try { v = await probe(); } catch { v = undefined; }
      const pos = rangePosition(v, rangeFor('claude-code')); this.versionAllowed = (pos !== 'below' && pos !== 'above') || !!this.deps.unsupportedOk || !!this.o.unsupportedOk;
    }
    if (this.versionAllowed) return true;
    this.emit({ type: 'error', code: 'provider_version_unsupported', tool_message: providerMessage('provider_version_unsupported', { engine: 'claude-code' }).body, fatal: true });
    this.emit({ type: 'status', state: 'error' }); this.emit({ type: 'turn.done', outcome: 'error', stop_reason: 'version_unsupported' }); return false;
  }

  /** A line longer than the cap means the stream cannot be trusted any more: report it and stop the process. */
  private tooLong(child: ChildProcess, parser: ClaudeStreamParser) {
    if (this.sawResult) return; this.sawResult = true; child.kill('SIGKILL'); for (const b of parser.closeOpen()) this.emit(b);
    this.emit({ type: 'error', code: 'provider_protocol_error', tool_message: 'Claude Code sent a line that was too long to read, so the turn was stopped.', fatal: true });
    this.emit({ type: 'status', state: 'error' }); this.emit({ type: 'turn.done', outcome: 'error', stop_reason: 'line_too_long' });
  }

  signal(sig: 'SIGINT' | 'SIGTERM' | 'SIGKILL') { try { this.child?.kill(sig); } catch { /* already gone */ } }

  private interrupted = false;
  private parser?: ClaudeStreamParser; private receiptCap = false; private reqN = 0; private receipts = new Map<string, (ok: boolean) => void>();
  private controlResponse(line: string) { try { const j = JSON.parse(line) as { type?: string; response?: { subtype?: string; request_id?: string } }; if (j.type !== 'control_response') return; const id = String(j.response?.request_id ?? ''); this.receipts.get(id)?.(j.response?.subtype === 'success'); this.receipts.delete(id); } catch { /* not ours */ } }
  private exitWait: Promise<void> = Promise.resolve();

  private handle(parser: ClaudeStreamParser, line: string) {
    if (line.includes('"control_response"')) { this.controlResponse(line); return; }
    for (const b of parser.push(line)) {
      if (b.type === 'session.started') this.sessionId = b.engine_session_id || this.sessionId;
      if (b.type === 'session.started') this.receiptCap = parser.initCapabilities?.includes('interrupt_receipt_v1') === true;
      if (b.type === 'turn.done') { this.sawResult = true; try { this.child?.stdin?.end(); } catch { /* gone */ } } // the turn is over: closing stdin lets the process finish
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
  /** The way to stop a turn: when the CLI says in `system/init` that it takes an interrupt request and answers with a receipt (`interrupt_receipt_v1`), ask it that way and wait for the receipt and the turn's result; otherwise (or when no receipt comes within the grace time, or for `hard`) SIGINT, then SIGTERM, then SIGKILL at 8 s, each to the whole process group. */
  async interrupt(o: { hard?: boolean } = {}): Promise<{ stopped: boolean; method?: 'protocol' | 'sigint'; receipt?: boolean; terminated?: Killed[] }> {
    const c = this.child;
    if (!c || this.sawResult) return { stopped: false };
    this.interrupted = true; if (this.parser) this.parser.interrupted = true;
    const graceMs = this.o.limits?.interrupt_grace_ms ?? 3000; const clock = this.deps.clock ?? realClock;
    if (!o.hard && this.receiptCap && c.stdin && c.stdin.writable && !c.stdin.destroyed) {
      const id = `req_${++this.reqN}`; const got = new Promise<boolean>((res) => { this.receipts.set(id, res); });
      c.stdin.write(JSON.stringify({ type: 'control_request', request_id: id, request: { subtype: 'interrupt' } }) + '\n');
      const wait = (ms: number) => new Promise<'late'>((res) => { clock.setTimeout(() => res('late'), ms); });
      const first = await Promise.race([got, this.exitWait.then(() => true), wait(graceMs).then(() => false)]); this.receipts.delete(id);
      if (first) { // the CLI took it: its result follows, then the process ends by itself
        const t0 = Date.now(); while (!this.sawResult && this.child && Date.now() - t0 < graceMs) await new Promise((r) => setTimeout(r, 10));
        try { c.stdin.end(); } catch { /* gone */ }
        if (!c.pid) { await this.exitWait; return { stopped: true, method: 'protocol', receipt: true, terminated: [] }; }
        const r = await signalLadder({ agentId: this.agentId, procs: this.procs(), exited: this.exitWait, graceMs, skipSigint: true, clock: this.deps.clock });
        return { stopped: true, method: 'protocol', receipt: true, terminated: r.terminated };
      }
    }
    if (!c.pid) { c.kill(o.hard ? 'SIGKILL' : 'SIGINT'); await this.exitWait; return { stopped: true, method: 'sigint', terminated: [] }; }
    const r = await signalLadder({ agentId: this.agentId, procs: this.procs(), exited: this.exitWait, graceMs, hard: o.hard, clock: this.deps.clock });
    return { stopped: true, method: 'sigint', receipt: false, terminated: r.terminated };
  }

  async stop() { this.closed = true; await this.interrupt(); this.bridge?.close(); this.events.close(); }
}
