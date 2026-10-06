/** A scriptable stand-in for a vendor engine (no process, no network). It can finish a turn, hang, ignore an interrupt, ignore SIGTERM, crash, or send an oversized line. */
import { AsyncQueue, type AgentEngine, type Capability, type EngineSession, type EngineStartOptions, type EventBody, type NormalisedEvent } from '@centcom/agent';

export interface FakeTurn {
  /** Events between `turn.started` and `turn.done`. Defaults to a short reply. */
  events?: EventBody[];
  /** Virtual or real milliseconds between events (needs `clock`); 0 = all at once. */
  gapMs?: number;
  /** Never finish the turn. */
  hang?: boolean;
  /** Ignore `interrupt()` (the turn keeps going). */
  ignoreInterrupt?: boolean;
  /** Ignore SIGTERM as well (only SIGKILL ends it). */
  ignoreTerm?: boolean;
  /** Die during the turn, as if the process was killed. */
  crash?: { signal?: string; code?: number };
  /** Behave like an engine that read a line over the 1 MiB cap. */
  oversizeLine?: boolean;
  outcome?: 'ok' | 'error' | 'canceled';
}
export interface FakeClock { now(): number; setTimeout(fn: () => void, ms: number): unknown }
export interface FakeEngineOptions { id?: 'fake' | 'claude-code' | 'codex'; clock?: FakeClock; script?: FakeTurn | FakeTurn[] | ((turn: number, session: FakeSession) => FakeTurn); startDelayMs?: number; failStart?: Error; ignoreStop?: boolean; hasExited?: boolean }

const CAPS = new Set<Capability>(['streaming', 'approvals', 'resume', 'interrupt']);
export const FAKE_REPLY: EventBody[] = [
  { type: 'status', state: 'thinking' }, { type: 'text.delta', message_id: 'msg_1', index: 0, text: 'Hello' }, { type: 'text.delta', message_id: 'msg_1', index: 1, text: ' there' },
  { type: 'tool.requested', tool_id: 'tool_1', name: 'Read', input_summary: 'README.md', risk: 'low' }, { type: 'tool.result', tool_id: 'tool_1', status: 'ok', summary: 'read 12 lines' }, { type: 'text.done', message_id: 'msg_1', text: 'Hello there', input_tokens: 10, output_tokens: 3 },
];

export class FakeEngine implements AgentEngine {
  readonly id: 'fake' | 'claude-code' | 'codex'; readonly provider = 'other' as const; readonly label = 'Fake';
  readonly sessions: FakeSession[] = []; readonly starts: { at: number; resume?: string }[] = [];
  constructor(readonly opts: FakeEngineOptions = {}) { this.id = opts.id ?? 'fake'; }
  capabilities() { return CAPS; }
  async start(o: EngineStartOptions): Promise<EngineSession> {
    this.starts.push({ at: this.opts.clock?.now() ?? 0, ...(o.resume ? { resume: o.resume.engine_session_id } : {}) });
    if (this.opts.failStart) throw this.opts.failStart;
    if (this.opts.startDelayMs && this.opts.clock) await new Promise<void>((r) => this.opts.clock!.setTimeout(r, this.opts.startDelayMs!));
    const s = new FakeSession(this, o); this.sessions.push(s); s.begin(); return s;
  }
}

export class FakeSession implements EngineSession {
  readonly agentId: string; readonly events = new AsyncQueue<NormalisedEvent>();
  readonly exited: Promise<{ code?: number; signal?: string }>; private exitedResolve!: (v: { code?: number; signal?: string }) => void;
  /** Everything a test may want to look at. */
  readonly signals: string[] = []; readonly prompts: string[] = []; readonly env: Record<string, string | undefined>; readonly envExact: boolean; interrupts = 0; stopped = false; dead = false;
  private seq = 0; private turn = 0; private turnId = ''; private active?: { turn: FakeTurn; cancelled: boolean };
  constructor(private engine: FakeEngine, readonly o: EngineStartOptions) {
    this.agentId = o.agentId; this.env = o.env ?? {}; this.envExact = !!o.envExact;
    this.exited = new Promise((res) => { this.exitedResolve = res; });
    if (!engine.opts.hasExited) (this as { exited: unknown }).exited = undefined;
  }
  resumeToken() { return `fake-session-${this.engine.sessions.indexOf(this) + 1}`; }
  begin() { this.emit({ type: 'session.started', engine: 'fake' as never, engine_session_id: this.resumeToken(), model: 'fake-1', tools: [], mcp_servers: [], capabilities: [...CAPS], login_kind: 'unknown' } as EventBody); }
  private emit(b: EventBody) { if (this.dead) return; this.events.push({ ...b, v: 1, seq: ++this.seq, ts: new Date(this.engine.opts.clock?.now() ?? 0).toISOString(), agent_id: this.agentId, ...(this.turnId ? { turn_id: this.turnId } : {}) } as NormalisedEvent); }
  private scriptFor(n: number): FakeTurn { const sc = this.engine.opts.script; if (typeof sc === 'function') return sc(n, this); if (Array.isArray(sc)) return sc[Math.min(n - 1, sc.length - 1)] ?? {}; return sc ?? {}; }

  async send(prompt: string): Promise<{ turn_id: string }> {
    if (this.stopped || this.dead) throw new Error('session closed');
    this.prompts.push(prompt); const n = ++this.turn; const t = this.scriptFor(n); this.turnId = `trn_${n}`; this.active = { turn: t, cancelled: false };
    this.emit({ type: 'turn.started', turn_id: this.turnId });
    const events = t.events ?? FAKE_REPLY; const active = this.active;
    const step = (i: number) => {
      if (this.dead || active.cancelled) return;
      if (t.crash && i === Math.min(1, events.length)) { this.die(t.crash.signal, t.crash.code); return; }
      if (t.oversizeLine) { this.emit({ type: 'error', code: 'provider_protocol_error', tool_message: 'A line from the engine was too long to read.', fatal: true }); this.emit({ type: 'turn.done', outcome: 'error', stop_reason: 'line_too_long' }); this.active = undefined; return; }
      if (i < events.length) { this.emit(events[i]!); if (t.gapMs && this.engine.opts.clock) this.engine.opts.clock.setTimeout(() => step(i + 1), t.gapMs); else step(i + 1); return; }
      if (t.hang) return;
      this.emit({ type: 'turn.done', outcome: t.outcome ?? 'ok' }); this.active = undefined;
    };
    step(0); return { turn_id: this.turnId };
  }
  async interrupt(): Promise<{ stopped: boolean }> {
    this.interrupts++; const a = this.active; if (!a) return { stopped: false }; if (a.turn.ignoreInterrupt) return { stopped: false };
    a.cancelled = true; this.active = undefined; this.emit({ type: 'turn.done', outcome: 'canceled' }); return { stopped: true };
  }
  async stop() { this.stopped = true; if (this.engine.opts.ignoreStop || this.active?.turn.ignoreInterrupt) return; /* a process that ignores interrupts is unresponsive to stop as well */ if (this.active && !this.active.turn.ignoreInterrupt) { this.active.cancelled = true; this.active = undefined; } this.events.close(); }
  signal(sig: 'SIGINT' | 'SIGTERM' | 'SIGKILL') {
    this.signals.push(sig); if (this.dead) return;
    if (sig === 'SIGKILL') return this.die('SIGKILL');
    if (sig === 'SIGTERM' && !this.active?.turn.ignoreTerm) this.die('SIGTERM'); // a polite process exits on SIGTERM
  }
  /** Simulates the process dying by itself (test helper and the effect of a signal). */
  crash(signal = 'SIGKILL', code?: number) { this.die(signal, code); }
  private die(signal?: string, code?: number) { if (this.dead) return; this.dead = true; this.active = undefined; this.exitedResolve({ ...(signal ? { signal } : {}), ...(code !== undefined ? { code } : {}) }); this.events.close(); }
}
