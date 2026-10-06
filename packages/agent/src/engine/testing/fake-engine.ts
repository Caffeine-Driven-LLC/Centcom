/** An engine that plays a transcript. No process, no network. It pauses where a person would act (send, interrupt, approve) and fills in what a real engine would emit around those moments. */
import { AsyncQueue } from '../../queue.js';
import type { AgentEngine, ApprovalDecision, Capability, EngineSession, EngineStartOptions, EventBody, NormalisedEvent, PermissionGate } from '../../types.js';
import type { RunnerClock } from '../../runner/types.js';
import type { ExpectStep, Transcript } from './transcript.js';

export interface FakeEngineDeps { clock: RunnerClock; /** 1 = real recorded timing, 0 = no waiting at all. */ speed?: number }
const CAPS = new Set<Capability>(['streaming', 'approvals', 'resume', 'interrupt']);
export interface ScriptedEngine extends AgentEngine { readonly sessions: ScriptedSession[] }

export function createFakeEngine(t: Transcript, d: FakeEngineDeps): ScriptedEngine {
  const sessions: ScriptedSession[] = [];
  return { id: 'fake', provider: 'other', label: 'Fake', sessions, capabilities: () => CAPS, async start(o) { const s = new ScriptedSession(t, d, o); sessions.push(s); void s.run(); return s; } };
}

export class ScriptedSession implements EngineSession {
  readonly agentId: string; readonly events = new AsyncQueue<NormalisedEvent>();
  /** What the script is waiting for next: a driver (or a test) reads this and acts. */
  readonly expectations = new AsyncQueue<ExpectStep>();
  readonly finished: Promise<void>; private done!: () => void; stopped = false;
  /** Set when the script could not continue (wrong prompt, the gate disagreed with the transcript). `replayTranscript` throws it. */
  failure?: Error;
  private seq = 0; private tools = new Set<string>(); private approvals = new Map<string, EventBody & { type: 'approval.requested' }>(); private turn?: string;
  private sends: string[] = []; private sendWaiter?: (p: string) => void; private intWaiter?: () => void; private intPending = false; private skipping = false;
  constructor(private t: Transcript, private d: FakeEngineDeps, private o: EngineStartOptions) { this.agentId = o.agentId; this.finished = new Promise((r) => { this.done = r; }); }
  resumeToken() { return 'fake-session'; }

  private emit(b: Record<string, unknown>) {
    const ev = { ...b, v: 1, seq: ++this.seq, ts: new Date(this.d.clock.now()).toISOString(), agent_id: this.agentId } as NormalisedEvent; this.events.push(ev);
    if (ev.type === 'turn.started') this.turn = ev.turn_id; if (ev.type === 'tool.requested') this.tools.add(ev.tool_id); if (ev.type === 'tool.result') this.tools.delete(ev.tool_id);
    if (ev.type === 'approval.requested') this.approvals.set(ev.approval_id, ev); if (ev.type === 'approval.resolved') this.approvals.delete(ev.approval_id); if (ev.type === 'turn.done') this.turn = undefined;
  }
  private sleep(ms: number) { const sp = this.d.speed ?? 0; return sp > 0 && ms > 0 ? new Promise<void>((r) => this.d.clock.setTimeout(r, ms / sp)) : Promise.resolve(); }

  async run() {
    try {
      for (const step of this.t.steps) {
        if (this.stopped) break;
        if ('event' in step) { if (this.skipping) continue; await this.sleep(step.at_ms); this.emit(step.event); continue; }
        this.expectations.push(step);
        if (step.expect === 'send') { this.skipping = false; const p = this.sends.shift() ?? (await new Promise<string>((r) => { this.sendWaiter = r; })); if (step.prompt !== undefined && p !== step.prompt) throw new Error(`transcript line ${step.line}: expected prompt "${step.prompt}", got "${p}"`); }
        else if (step.expect === 'interrupt') { if (!this.intPending) await new Promise<void>((r) => { this.intWaiter = r; }); this.intPending = false; this.interruptNow(); }
        else if (step.expect === 'approval') await this.askGate(step);
      }
    } catch (e) { this.failure = e as Error; } finally { this.done(); }
  }

  /** What a real engine does when told to stop mid-turn: close every open tool, resolve every open approval, end the turn. In that order. */
  private interruptNow() {
    for (const id of [...this.approvals.keys()]) this.emit({ type: 'approval.resolved', approval_id: id, decision: 'deny', scope: 'once', by: 'interrupt' });
    for (const id of [...this.tools]) this.emit({ type: 'tool.result', tool_id: id, status: 'canceled', summary: 'Canceled' });
    this.emit({ type: 'turn.done', outcome: 'canceled', stop_reason: 'interrupted' }); this.skipping = true;
  }

  private async askGate(step: Extract<ExpectStep, { expect: 'approval' }>) {
    const req = [...this.approvals.values()].at(-1); if (!req) throw new Error(`transcript line ${step.line}: expect approval without a pending approval.requested`);
    const gate: PermissionGate | undefined = this.o.approvalGate; let dec: ApprovalDecision;
    try { dec = gate ? await gate.decide({ approval_id: req.approval_id, agent_id: this.agentId, tool_id: req.tool_id, tool: 'tool', summary: req.summary, risk: req.risk, ...(req.command ? { command: req.command } : {}) }) : { decision: step.decision, scope: 'once' }; }
    catch { dec = { decision: 'deny', scope: 'once' }; } // a gate that throws denies
    this.emit({ type: 'approval.resolved', approval_id: req.approval_id, decision: dec.decision, scope: dec.scope, by: 'user' });
    if (dec.decision !== step.decision) throw new Error(`transcript line ${step.line}: the transcript expects ${step.decision}, the gate said ${dec.decision}`);
  }

  async send(prompt: string) { const turn_id = `trn_${this.seq + 1}`; if (this.sendWaiter) { const w = this.sendWaiter; this.sendWaiter = undefined; w(prompt); } else this.sends.push(prompt); return { turn_id }; }
  async interrupt() { const active = this.turn !== undefined || !!this.intWaiter; this.intPending = true; if (this.intWaiter) { const w = this.intWaiter; this.intWaiter = undefined; w(); } return { stopped: active, escalated: 'none' as const, duration_ms: 0 }; }
  async stop() { this.stopped = true; this.sendWaiter?.(''); this.intWaiter?.(); this.events.close(); this.expectations.close(); return { exit_code: 0, signal: null }; }
}
