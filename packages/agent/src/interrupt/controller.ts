/** One way to stop an agent, whatever the engine: end the turn, deny its open approvals, clean up its processes, leave it idle with the partial answer kept. */
import type { LadderClock } from './ladder.js';
import { realClock } from './ladder.js';
import type { Killed } from './procs.js';

export type InterruptReason = 'user' | 'signal' | 'timeout' | 'shutdown';
export interface InterruptResult { agentId: string; method: 'protocol' | 'sigint' | 'none'; stoppedStream: boolean; cancelledApprovals: number; terminated: Killed[]; durationMs: number }
/** What the controller needs from an agent. Engines report how they stopped (`method`, `terminated`); older ones that only say `stopped` count as a signal stop. */
export interface InterruptTarget {
  busy(): boolean; turnId(): string | undefined;
  interrupt(o: { hard: boolean }): Promise<{ stopped: boolean; method?: 'protocol' | 'sigint'; terminated?: Killed[] }>;
}
export interface InterruptDeps {
  targets: { get(agentId: string): InterruptTarget | undefined; busyIds(): string[] };
  /** Denies every open approval of the agent with reason `interrupted`, closes their prompts, and returns how many there were. */
  approvals: { cancel(agentId: string): number };
  /** Puts the agent in `idle` and flags its partial message `interrupted: true`. */
  states: { interrupted(agentId: string): void };
  emit: (e: { agent_id: string; reason: InterruptReason; hard: boolean; method: InterruptResult['method'] }) => void;
  clock?: LadderClock & { now(): number };
  log?: { warn(msg: string, f?: Record<string, unknown>): void };
  /** The engine ignored the interrupt this long: give up on it, mark the agent idle, drop the rest of that turn (default 8 s + 1 s). */
  giveUpMs?: number;
}
export interface InterruptController {
  interrupt(agentId: string, o?: { mode?: 'soft' | 'hard'; reason?: InterruptReason }): Promise<InterruptResult>;
  /** True for a turn that was interrupted: a late approval for it is denied without asking. */
  cancelledTurn(turnId: string | undefined): boolean;
  /** ctrl+c semantics. Busy: first = soft interrupt of every busy agent, second within 1 s = hard and exit 130. Idle: first shows a hint, second within 2 s exits 0. */
  ctrlC(): 'interrupted' | 'hard' | 'hint' | 'exit';
  /** Installs ctrl+c handling on SIGINT for a headless run. Returns the uninstall function. */
  onSignal(proc: NodeJS.Process, o: { exit: (code: number) => void; hint: (text: string) => void }): () => void;
}

export function createInterruptController(d: InterruptDeps): InterruptController {
  const clock = d.clock ?? { ...realClock, now: () => Date.now() }; const inFlight = new Map<string, Promise<InterruptResult>>(); const cancelled = new Set<string>();
  let lastBusyPress = -Infinity; let lastIdlePress = -Infinity; let onExit: ((code: number) => void) | undefined; let onHint: ((t: string) => void) | undefined;

  async function run(agentId: string, hard: boolean, reason: InterruptReason): Promise<InterruptResult> {
    const t0 = clock.now(); const tg = d.targets.get(agentId);
    const done = (r: Omit<InterruptResult, 'agentId' | 'durationMs'>): InterruptResult => ({ agentId, durationMs: clock.now() - t0, ...r });
    if (!tg || !tg.busy()) return done({ method: 'none', stoppedStream: false, cancelledApprovals: 0, terminated: [] });
    const turn = tg.turnId(); if (turn) cancelled.add(turn);
    const cancelledApprovals = d.approvals.cancel(agentId); // no approval stays open, whatever the engine does next
    let r: Awaited<ReturnType<InterruptTarget['interrupt']>> | undefined; const giveUp = d.giveUpMs ?? 9000; let h: unknown;
    try { r = await Promise.race([tg.interrupt({ hard }), new Promise<undefined>((res) => { h = clock.setTimeout(() => res(undefined), giveUp); })]); }
    catch (e) { d.log?.warn('interrupt.failed', { agent_id: agentId, err: String(e) }); } finally { clock.clearTimeout(h); }
    if (!r) d.log?.warn('interrupt.ignored', { agent_id: agentId, after_ms: giveUp }); // the agent is set idle locally; later events of that turn are dropped by turn id
    const method: InterruptResult['method'] = r?.method ?? (r?.stopped ? 'sigint' : 'none');
    d.states.interrupted(agentId); d.emit({ agent_id: agentId, reason, hard, method });
    return done({ method, stoppedStream: true, cancelledApprovals, terminated: r?.terminated ?? [] });
  }

  const ctl: InterruptController = {
    interrupt(agentId, o = {}) {
      const hard = o.mode === 'hard'; const cur = inFlight.get(agentId);
      if (cur) { if (hard) void run(agentId, true, o.reason ?? 'user'); return cur; } // concurrent interrupts share one ladder (a hard one may still escalate it)
      const p = run(agentId, hard, o.reason ?? 'user').finally(() => inFlight.delete(agentId)); inFlight.set(agentId, p); return p;
    },
    cancelledTurn: (t) => !!t && cancelled.has(t),
    ctrlC() {
      const now = clock.now(); const busy = d.targets.busyIds();
      if (busy.length || inFlight.size) {
        if (now - lastBusyPress <= 1000) { lastBusyPress = -Infinity; for (const id of new Set([...busy, ...inFlight.keys()])) void ctl.interrupt(id, { mode: 'hard', reason: 'signal' }); onExit?.(130); return 'hard'; }
        lastBusyPress = now; for (const id of busy) void ctl.interrupt(id, { reason: 'signal' }); return 'interrupted';
      }
      if (now - lastIdlePress <= 2000) { onExit?.(0); return 'exit'; }
      lastIdlePress = now; onHint?.('Press ctrl+c again to exit'); return 'hint';
    },
    onSignal(proc, o) {
      onExit = o.exit; onHint = o.hint; const h = () => { ctl.ctrlC(); }; proc.on('SIGINT', h);
      return () => { proc.off('SIGINT', h); onExit = undefined; onHint = undefined; };
    },
  };
  return ctl;
}
