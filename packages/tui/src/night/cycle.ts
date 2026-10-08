import { counts, initialNight, NIGHT_MAX_TASKS, nightDecision, parseTasks, renderReport, reportName, taskPrompt, type NightDecision, type NightState, type NightTask } from './model.js';
import type { Risk } from '@centcom/agent';

export interface NightHost {
  get(): NightState; set(patch: Partial<NightState> | ((n: NightState) => Partial<NightState>)): void;
  /** Sends one prompt to the agent (only called when it is idle): `shown` is what the transcript says, `wire` is what the agent receives. */ submit(shown: string, wire: string): Promise<void>;
  interrupt(): Promise<void>; /** The agent's last message in the transcript. */ lastAssistantText(): string;
  notice(level: 'info' | 'warn' | 'error' | 'ok', text: string, detail?: string): void;
  now(): number; id(): string;
  /** Called after the report is written or the queue changes (persistence is the host's business). */ saved?(): void;
  writeReport?(name: string, text: string): string | undefined;
  setTimer(fn: () => void, ms: number): unknown; clearTimer(h: unknown): void;
}
/** Error codes after which more tasks would fail the same way: stop and keep the queue. */
const STOPPERS: Record<string, string> = { provider_not_signed_in: 'the agent is signed out', provider_cap_reached: 'the usage limit was reached', provider_not_installed: 'the agent tool is not installed', provider_method_disabled: 'this provider is switched off', provider_policy_blocked: 'a policy blocks this provider' };

/** Works through the queue one task at a time while nobody is there. */
export class NightCycle {
  private current?: string; private timer?: unknown; private timedOut = false; private userStop = false; private lastError?: { code: string; fatal: boolean };
  constructor(private h: NightHost, private o: { gapMs?: number } = {}) {}
  get state(): NightState { return this.h.get(); }
  /** Approvals and questions are answered by rule while a task runs. */
  active(): boolean { return this.state.running; }
  decide(r: { tool: string; risk: Risk; command?: string }): NightDecision {
    const d = nightDecision(r); const t = this.task(this.current); if (t) this.update(t.id, (x) => (d.decision === 'approve' ? { approved: x.approved + 1 } : { denied: x.denied + 1 })); return d;
  }
  private task(id?: string): NightTask | undefined { return id ? this.state.tasks.find((t) => t.id === id) : undefined; }
  private update(id: string, f: (t: NightTask) => Partial<NightTask>): void { this.h.set((n) => ({ tasks: n.tasks.map((t) => (t.id === id ? { ...t, ...f(t) } : t)) })); }

  arm(on: boolean): void { this.h.set({ armed: on }); }
  /** Adds tasks from pasted text; returns how many were added. */
  add(text: string): number {
    const room = NIGHT_MAX_TASKS - this.state.tasks.length; const parsed = parseTasks(text).slice(0, Math.max(0, room));
    if (!parsed.length) return 0;
    this.h.set((n) => ({ tasks: [...n.tasks, ...parsed.map((t): NightTask => ({ id: this.h.id(), text: t, status: 'queued', approved: 0, denied: 0 }))], ...(n.running ? {} : { stopped: undefined }) })); this.h.saved?.(); return parsed.length;
  }
  remove(index: number): boolean { const t = this.state.tasks[index - 1]; if (!t || t.status === 'running') return false; this.h.set((n) => ({ tasks: n.tasks.filter((x) => x.id !== t.id) })); this.h.saved?.(); return true; }
  clear(): void { this.h.set((n) => ({ tasks: n.tasks.filter((t) => t.status === 'running') })); this.h.saved?.(); }
  setTimeoutMin(m: number): void { this.h.set({ taskTimeoutMin: Math.max(1, Math.min(480, Math.round(m))) }); this.h.saved?.(); }

  start(): { ok: boolean; why?: string } {
    if (this.state.running) return { ok: false, why: 'The night cycle is already running.' };
    if (!this.state.tasks.some((t) => t.status === 'queued')) return { ok: false, why: 'There is nothing queued. Add tasks first.' };
    this.userStop = false;
    this.h.set({ running: true, armed: true, startedAt: this.h.now(), endedAt: undefined, stopped: undefined, reportPath: undefined });
    this.h.notice('info', `Night cycle started: ${counts(this.state).queued} tasks. Nobody is asked anything until it ends.`);
    this.h.setTimer(() => void this.next(), 0); return { ok: true };
  }
  /** You stopped it: the running task is interrupted and goes back in the queue. */
  async stop(reason = 'you stopped it'): Promise<void> {
    if (!this.state.running) return; this.userStop = true; const id = this.current; this.clearTimer();
    if (id) { await this.h.interrupt().catch(() => undefined); }
    this.finish(reason, true);
  }
  private clearTimer(): void { if (this.timer !== undefined) { this.h.clearTimer(this.timer); this.timer = undefined; } }

  private async next(): Promise<void> {
    if (!this.state.running) return;
    const t = this.state.tasks.find((x) => x.status === 'queued'); if (!t) { this.finish(undefined, false); return; }
    const total = this.state.tasks.length; const index = this.state.tasks.indexOf(t) + 1;
    this.current = t.id; this.timedOut = false; this.lastError = undefined;
    this.update(t.id, () => ({ status: 'running', startedAt: this.h.now(), endedAt: undefined, error: undefined, approved: 0, denied: 0 }));
    this.timer = this.h.setTimer(() => { this.timedOut = true; void this.h.interrupt().catch(() => undefined); }, this.state.taskTimeoutMin * 60_000);
    try { await this.h.submit(`[night ${index}/${total}] ${t.text}`, taskPrompt(t, index, total)); } catch (e) { this.taskEnded('error', String(e instanceof Error ? e.message : e)); }
  }
  noteError(code: string, fatal: boolean): void { if (this.state.running) this.lastError = { code, fatal }; }
  /** The controller calls this when the agent's turn ends. */
  turnDone(outcome: 'ok' | 'error' | 'canceled' | string): void { if (this.state.running && this.current) this.taskEnded(outcome); }
  private taskEnded(outcome: string, why?: string): void {
    const id = this.current; if (!id) return; this.clearTimer(); this.current = undefined; const now = this.h.now();
    const summary = this.h.lastAssistantText().trim().slice(0, 1500) || undefined;
    if (outcome === 'canceled' && !this.timedOut) { // the user (or something else) interrupted: keep the task for later and stop
      this.update(id, () => ({ status: 'queued', startedAt: undefined })); this.finish('the running task was interrupted', true); return;
    }
    if (this.timedOut) this.update(id, () => ({ status: 'timeout', endedAt: now, summary, error: `took longer than ${this.state.taskTimeoutMin} minutes and was stopped` }));
    else if (outcome === 'ok') this.update(id, () => ({ status: 'done', endedAt: now, summary }));
    else { const stop = this.lastError && STOPPERS[this.lastError.code]; if (stop) { this.update(id, () => ({ status: 'queued', startedAt: undefined })); this.finish(stop, true); return; } this.update(id, () => ({ status: 'failed', endedAt: now, summary, error: why ?? (this.lastError ? `the agent reported ${this.lastError.code}` : 'the turn ended with an error') })); }
    this.h.saved?.();
    if (this.userStop) return;
    this.h.setTimer(() => void this.next(), this.o.gapMs ?? 1500);
  }
  private finish(stopped: string | undefined, early: boolean): void {
    this.clearTimer(); this.current = undefined; const now = this.h.now();
    this.h.set({ running: false, endedAt: now, stopped: early ? stopped : undefined });
    const path = this.h.writeReport?.(reportName(new Date(now)), renderReport(this.state, now)); if (path) this.h.set({ reportPath: path });
    const c = counts(this.state); this.h.saved?.();
    this.h.notice(early ? 'warn' : c.failed ? 'warn' : 'ok', early ? `Night cycle stopped: ${stopped}. ${c.done} done, ${c.queued} still queued.` : `Night cycle finished: ${c.done} of ${c.total} tasks done${c.failed ? `, ${c.failed} failed` : ''}.`, path ? `Report: ${path}` : undefined);
  }
}
export { initialNight };
