/**
 * Shares a running conversation: what the agent on this computer does goes out as session events (the host is the only one who
 * emits them in a command post), and what editors ask for comes in through the session's queue, to be approved by the host.
 *
 *   out:  user messages, assistant text (coalesced, at most ten frames a second), tool requests and results, approvals and
 *         whether the agent is working;
 *   in:   `queue.submit` frames of editors: each waits for the host's approval (or goes straight through with auto-approve),
 *         is then run as the agent's next message (one at a time, when it is idle) and ends with `queue.done`.
 *
 * It never reads or sends anything that is not in the transcript the host already sees. Viewers cannot send; an editor's text is never
 * run as a slash command.
 */
import { QueueClient, type QueueItem, type SessionHandle } from '@centcom/net';
import { newIdGenerator } from '@centcom/protocol';
import type { LockHub, LockLink } from '@centcom/agent';
import type { AppController } from '../controller.js';
import type { Item } from '../state/model.js';
import { gitBranchInfo, type BranchProbe } from './git-info.js';
import { TeamModel } from './team.js';

export interface HostBridgeOptions {
  /** run editors' requests without asking the host */ autoApprove?: boolean;
  /** called when the pending list, the roster or the sharing state changed */ onChange?(): void;
  onError?(e: unknown): void;
  /** the longest wait before streamed text goes out (default 100 ms) */ flushMs?: number;
  /** `command_post` (default): the host runs the agent and editors ask. `branch`: this person runs their own agent and publishes it; nobody asks. */ mode?: 'command_post' | 'branch';
  /** branch mode: whether the agent's messages and tool summaries go to the team (state, branch and locks always do). Default true. */ shareActivity?: boolean;
  /** branch mode: reads the branch of the working folder (default: git) */ branchProbe?: BranchProbe;
  /** branch mode: where the session plugs into this runtime's file locks */ locks?: LockHub;
  /** branch mode: a teammate's agent is working on a file this person's agent is changing */ onConflict?(c: { agents: string[]; hmacs: string[] }): void;
}
export interface PendingRequest { item: string; from: string; slot: number; text: string; ts: string }
const ID_OK = { agt: /^agt_[0-9A-HJKMNP-TV-Z]{26}$/, apr: /^apr_[0-9A-HJKMNP-TV-Z]{26}$/, msg: /^msg_[0-9A-HJKMNP-TV-Z]{26}$/ } as const;
const RISKS = new Set(['low', 'medium', 'high']);

export class HostBridge {
  readonly queue: QueueClient;
  /** branch mode: who is working on what, built from the session */ readonly team?: TeamModel;
  readonly mode: 'command_post' | 'branch'; private shareActivity: boolean; private offLink?: () => void; private offAny?: () => void; private offLockEvents?: () => void; private lastBranchAt = 0; private wasWaiting = false; private branchTimer?: ReturnType<typeof setTimeout>;
  private readonly ids = newIdGenerator({ now: () => Date.now(), random: (n) => crypto.getRandomValues(new Uint8Array(n)) });
  private readonly mapped = new Map<string, string>(); private seen = new Set<string>(); private sentLen = new Map<string, number>(); private deltaIndex = new Map<string, number>(); private doneSent = new Set<string>();
  private toolSent = new Map<string, 'request' | 'result'>(); private approvals = new Set<string>(); private wasBusy = false; private chain: Promise<unknown> = Promise.resolve();
  private flushTimer?: ReturnType<typeof setTimeout>; private offStore?: () => void; private offTurn?: () => void; private stopped = false; private busyWaiters: (() => void)[] = []; private readonly stoppers = new Set<() => void>();
  private active?: { item: string; from: { name: string; slot: number } }; private working = false; private autoApprove: boolean; private tagNext?: string;
  constructor(private readonly ctl: AppController, private readonly handle: SessionHandle, private readonly o: HostBridgeOptions = {}) {
    this.autoApprove = o.autoApprove === true; this.queue = new QueueClient(handle); this.mode = o.mode ?? 'command_post'; this.shareActivity = o.shareActivity !== false;
    if (this.mode === 'branch') { this.team = new TeamModel(); this.team.setRoster(handle.roster(), handle.me.id); }
  }

  start(): void {
    for (const i of this.ctl.state.items) { this.seen.add(i.id); if (i.kind === 'assistant') { this.sentLen.set(i.id, i.text.length); if (i.done) this.doneSent.add(i.id); } if (i.kind === 'tool') this.toolSent.set(i.id, i.status === 'running' ? 'request' : 'result'); }
    this.wasBusy = this.ctl.state.busy;
    this.offStore = this.ctl.store.subscribe(() => this.onState());
    this.offTurn = this.ctl.onTurnEnd(() => { void this.settle().then(() => { this.setState('idle'); void this.publishBranch(); }); });
    this.queue.on('changed', () => { this.o.onChange?.(); void this.pump(); }); this.queue.on('error', (e) => this.o.onError?.(e));
    this.handle.on('roster', () => this.o.onChange?.());
    this.emit('agent.spawn', { p: { agent_id: this.agent(), owner: this.handle.me.id, mode: this.mode, runs_on: this.handle.me.id, provider: this.ctl.state.engineId === 'codex' ? 'openai' : this.ctl.state.engineId === 'claude-code' ? 'anthropic' : 'other' }, secret: { label: this.ctl.state.engineLabel, ...(this.mode === 'branch' ? { worktree: this.ctl.state.cwd } : {}) } });
    if (this.mode === 'command_post') { this.emitActivity('message.system', { secret: { level: 'info', text: 'This conversation is now shared.' } }); void this.pump(); } else this.startBranch();
  }
  stop(): void { if (this.mode === 'branch' && !this.stopped) this.emit('agent.exit', { p: { agent_id: this.agent(), outcome: 'ok' } }); this.offAny?.(); this.offLink?.(); if (this.branchTimer) clearTimeout(this.branchTimer); this.stopped = true; this.offStore?.(); this.offTurn?.(); this.queue.dispose(); if (this.flushTimer) clearTimeout(this.flushTimer); if (this.stateTimer) clearTimeout(this.stateTimer); for (const w of this.busyWaiters.splice(0)) w(); for (const f of [...this.stoppers]) f(); }

  setAutoApprove(on: boolean): void { this.autoApprove = on; void this.pump(); this.o.onChange?.(); }
  get autoApproving(): boolean { return this.autoApprove; }
  /** Editors' requests waiting for the host. */
  pending(): PendingRequest[] {
    return this.queue.snapshot().items.filter((i) => i.state === 'queued' && i.submitter !== this.handle.me.id && i.body !== undefined).map((i) => this.requestOf(i));
  }
  private requestOf(i: QueueItem): PendingRequest { const m = this.handle.roster().find((r) => r.id === i.submitter); return { item: i.id, from: m?.name || 'Someone', slot: m?.slot ?? 0, text: i.body ?? '', ts: i.ts }; }
  async approve(item: string): Promise<void> { await this.queue.approve(item); void this.pump(); }
  async reject(item: string, code: 'not_now' | 'off_topic' | 'unsafe' | 'duplicate' | 'other' = 'not_now'): Promise<void> { await this.queue.reject(item, code); this.o.onChange?.(); }

  /** Approved items run one at a time, when the agent is idle. */
  private async pump(): Promise<void> {
    if (this.working || this.stopped) return; this.working = true;
    try {
      for (;;) {
        if (this.stopped) return; const items = this.queue.snapshot().items;
        if (this.autoApprove) for (const i of items) if (i.state === 'queued' && i.submitter !== this.handle.me.id && i.body !== undefined) await this.queue.approve(i.id).catch((e) => this.o.onError?.(e));
        const next = this.queue.snapshot().items.find((i) => i.state === 'approved' && i.body !== undefined);
        if (!next) return;
        await this.untilIdle(); if (this.stopped) return;
        const from = this.requestOf(next); this.active = { item: next.id, from: { name: from.from, slot: from.slot } };
        await this.queue.claim(next.id, this.agent()).catch((e) => this.o.onError?.(e)); this.tagNext = next.id;
        const turn = this.turnEnds(); const ok = await this.ctl.submitRemote(this.active.from, next.body ?? ''); this.tagNext = undefined;
        if (!ok) { turn.cancel(); await this.queue.done(next.id, 'error').catch(() => undefined); this.active = undefined; continue; }
        await turn.ended; await this.settle(); await this.queue.done(next.id, 'ok').catch((e) => this.o.onError?.(e)); this.active = undefined;
      }
    } finally { this.working = false; }
  }
  private untilIdle(): Promise<void> { return this.ctl.state.busy ? new Promise((r) => this.busyWaiters.push(() => { if (!this.ctl.state.busy) r(); else this.busyWaiters.push(() => r()); })) : Promise.resolve(); }
  /** Resolves when the turn that is about to start has ended, or at once when the bridge is stopped. */
  private turnEnds(): { ended: Promise<void>; cancel(): void } {
    let stop = (): void => undefined; let off = (): void => undefined;
    const ended = new Promise<void>((r) => { off = this.ctl.onTurnEnd(() => { off(); r(); }); stop = r; this.stoppers.add(stop); });
    return { ended: ended.finally(() => this.stoppers.delete(stop)), cancel: () => { off(); stop(); } };
  }

  /** Everything the agent did so far is out before the next thing is said (a request's `queue.done` must not overtake its answer). */
  private async settle(): Promise<void> { this.onState(); if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = undefined; } this.flush(); await this.chain; }
  private idOf(kind: 'agt' | 'apr' | 'msg', raw: string): string { if (ID_OK[kind].test(raw)) return raw; const k = `${kind}:${raw}`; let v = this.mapped.get(k); if (!v) { v = this.ids.next(kind); this.mapped.set(k, v); } return v; }
  private agent(): string { return this.idOf('agt', this.ctl.state.agents.find((a) => a.mine)?.id ?? this.ctl.state.activeAgent); }
  /** The relay allows two `agent.state` frames a second per agent: the latest state wins, sent at most every 600 ms. */
  private lastState?: { state: string; at: number }; private wantState?: string; private stateTimer?: ReturnType<typeof setTimeout>;
  private setState(state: string): void {
    if (this.stopped) return; this.wantState = state; if (this.stateTimer) return;
    const wait = Math.max(0, 600 - (Date.now() - (this.lastState?.at ?? 0)));
    this.stateTimer = setTimeout(() => { this.stateTimer = undefined; const st = this.wantState; if (!st || this.stopped || st === this.lastState?.state) return; this.lastState = { state: st, at: Date.now() }; this.emit('agent.state', { p: { agent_id: this.agent(), state: st, since: new Date().toISOString() } }); }, wait); this.stateTimer.unref?.();
  }
  /** One lost frame must not hold back the ones behind it. */
  private emit(kind: string, body: { p?: Record<string, unknown>; secret?: Record<string, unknown> }): void {
    if (this.stopped) return; this.chain = this.chain.then(() => withTimeout(this.handle.sendEvent(kind, body as never), 8000, kind)).catch((e) => this.o.onError?.(e));
  }

  /** Messages and tool summaries: only while the person shares this agent's activity (state, branch and locks always go). */
  private emitActivity(kind: string, body: { p?: Record<string, unknown>; secret?: Record<string, unknown> }): void { if (this.mode === 'branch' && !this.shareActivity) return; this.emit(kind, body); }
  /** branch mode: whether the team sees what this agent says and does. */
  setShareActivity(on: boolean): void { this.shareActivity = on; this.o.onChange?.(); }
  get sharingActivity(): boolean { return this.shareActivity; }

  /* ---------------------------------------------------------------- branch mode */
  private startBranch(): void {
    const team = this.team!; this.offAny = this.handle.onAny((e) => { team.apply(e); this.onTeamEvent(e); }, { replay: true });
    const offRoster = this.handle.on('roster', () => { team.setRoster(this.handle.roster(), this.handle.me.id); this.o.onChange?.(); }); const prev = this.offAny; this.offAny = () => { prev(); offRoster(); };
    const offTeam = team.subscribe(() => this.o.onChange?.()); const prev2 = this.offAny; this.offAny = () => { prev2(); offTeam(); };
    this.ctl.setRemoteAgentNamer?.((id) => { for (const m of team.snapshot().members) if (m.agents.some((a) => a.id === id)) return `${m.you ? 'Your' : m.name + "'s"} agent`; return undefined; });
    if (this.o.locks) {
      const hub = this.o.locks; const link: LockLink = {
        publish: (p) => this.emit('file.lock', { p: p.clear as unknown as Record<string, unknown>, secret: p.secret }),
        ready: () => this.handle.link() === 'online', pathMac: (path) => this.handle.pathMac(path), wireId: (local) => this.idOf('agt', local),
        conflict: (c) => { this.emit('conflict.detected', { p: c as unknown as Record<string, unknown> }); this.o.onConflict?.({ agents: c.agent_ids, hmacs: c.path_hmacs }); },
      };
      this.offLink = hub.attach(link);
    }
    void this.publishBranch(true);
  }
  /** A teammate's lock reaches this runtime's lock client, which warns when a local agent is changing the same file. */
  private onTeamEvent(e: { kind: string; from: string; ts?: string; p?: Record<string, unknown> }): void {
    if (e.kind !== 'file.lock' || !e.p || e.from === this.handle.me.id) return;
    const action = String(e.p['action']); // the lock client times a lock from receipt: a sender's timestamp is never used
    this.o.locks?.remote({ action: action as never, path_hmac: String(e.p['path_hmac'] ?? ''), agent_id: String(e.p['agent_id'] ?? ''), ...(typeof e.p['ttl_ms'] === 'number' ? { ttl_ms: e.p['ttl_ms'] } : {}) });
  }
  /** Branch, head, ahead/behind and whether there are changes, at most every few seconds. */
  async publishBranch(force = false): Promise<void> {
    if (this.mode !== 'branch' || this.stopped) return; const wait = 4000 - (Date.now() - this.lastBranchAt);
    if (!force && wait > 0) { if (!this.branchTimer) { this.branchTimer = setTimeout(() => { this.branchTimer = undefined; void this.publishBranch(true); }, wait); this.branchTimer.unref?.(); } return; }
    this.lastBranchAt = Date.now(); const info = await (this.o.branchProbe ?? gitBranchInfo)(this.ctl.state.cwd).catch(() => undefined); if (!info || this.stopped) return;
    this.emit('branch.update', { secret: { agent_id: this.agent(), ...info } });
  }
  /** Offers the work of this agent to another member (they accept or decline in their app). */
  offerHandoff(to: string, note?: string): string { const id = this.ids.next('msg'); this.emit('agent.handoff', { p: { handoff: id, agent_id: this.agent(), to, op: 'offer' }, ...(note ? { secret: { note: note.slice(0, 2000) } } : {}) }); return id; }
  answerHandoff(id: string, accept: boolean): void { const h = this.team?.snapshot().handoffs.find((x) => x.id === id); if (!h || h.to !== this.handle.me.id) return; this.emit('agent.handoff', { p: { handoff: id, agent_id: h.agent, to: h.to, op: accept ? 'accept' : 'decline' } }); }

  private onState(): void {
    const st = this.ctl.state; const agent = this.agent();
    for (const it of st.items) this.item(it, agent);
    if (this.mode === 'branch') { const waiting = st.approvals.length > 0; if (waiting !== this.wasWaiting) { this.wasWaiting = waiting; this.setState(waiting ? 'awaiting-approval' : st.busy ? 'thinking' : 'idle'); } }
    else for (const a of st.approvals) { const id = a.req.approval_id; if (!this.approvals.has(id)) { this.approvals.add(id); this.emit('approval.request', { p: { approval_id: this.idOf('apr', id), agent_id: agent, risk: RISKS.has(a.req.risk) ? a.req.risk : 'medium', expires_at: new Date(a.expiresAt ?? Date.now() + 120_000).toISOString(), approver: 'host' }, secret: { summary: a.req.summary.slice(0, 2000), ...(a.req.command ? { command: a.req.command.slice(0, 2000) } : {}) } }); } }
    const live = new Set(st.approvals.map((a) => a.req.approval_id));
    if (this.mode === 'command_post') for (const id of [...this.approvals]) if (!live.has(id)) { this.approvals.delete(id); const t = st.items.find((i) => i.kind === 'tool' && i.approval && (i as { approvalId?: string }).approvalId === id); this.emit('approval.decision', { p: { approval_id: this.idOf('apr', id), decision: t && (t as { approval?: string }).approval === 'denied' ? 'deny' : 'approve', scope: 'once' } }); }
    if (st.busy !== this.wasBusy) { this.wasBusy = st.busy; for (const w of this.busyWaiters.splice(0)) w(); }
  }
  private item(it: Item, agent: string): void {
    if (it.kind === 'user') {
      if (this.seen.has(it.id)) return; this.seen.add(it.id);
      const queueItem = it.member && this.tagNext ? this.tagNext : undefined; this.setState('thinking');
      this.emitActivity('message.user', { secret: { text: it.text.slice(0, 60_000), agent_id: agent, ...(queueItem ? { queue_item: queueItem } : {}) } }); return;
    }
    if (it.kind === 'assistant') { this.seen.add(it.id); const sent = this.sentLen.get(it.id) ?? 0; if (it.text.length > sent || (it.done && !this.doneSent.has(it.id))) this.scheduleFlush(); return; }
    if (it.kind === 'tool') {
      const was = this.toolSent.get(it.id);
      if (!was) { this.toolSent.set(it.id, 'request'); this.emitActivity('tool.request', { secret: { agent_id: agent, tool_id: it.toolId, name: it.name, input_summary: it.summary.slice(0, 4000), risk: RISKS.has(it.risk) ? it.risk : 'medium' } }); }
      if (it.status !== 'running' && this.toolSent.get(it.id) !== 'result') { this.toolSent.set(it.id, 'result'); this.emitActivity('tool.result', { secret: { agent_id: agent, tool_id: it.toolId, status: it.status === 'ok' || it.status === 'error' || it.status === 'denied' || it.status === 'canceled' ? it.status : 'error', summary: (it.result ?? it.summary).slice(0, 4000) } }); }
      return;
    }
    if (it.kind === 'notice' && (it.level === 'warn' || it.level === 'error') && !this.seen.has(it.id)) { this.seen.add(it.id); this.emitActivity('message.system', { secret: { level: it.level === 'error' ? 'error' : 'warn', text: it.text.slice(0, 2000) } }); }
  }
  private scheduleFlush(): void { if (this.flushTimer || this.stopped) return; this.flushTimer = setTimeout(() => { this.flushTimer = undefined; this.flush(); }, this.o.flushMs ?? 100); this.flushTimer.unref?.(); }
  private flush(): void {
    const agent = this.agent();
    for (const it of this.ctl.state.items) {
      if (it.kind !== 'assistant') continue; const mid = this.idOf('msg', it.messageId); const sent = this.sentLen.get(it.id) ?? 0;
      if (it.text.length > sent) { const delta = it.text.slice(sent); this.sentLen.set(it.id, it.text.length); const index = this.deltaIndex.get(it.id) ?? 0; this.deltaIndex.set(it.id, index + 1); this.emitActivity('message.assistant.delta', { secret: { agent_id: agent, message_id: mid, index, delta: delta.slice(0, 60_000) } }); }
      if (it.done && !this.doneSent.has(it.id)) { this.doneSent.add(it.id); this.emitActivity('message.assistant.done', { secret: { agent_id: agent, message_id: mid } }); }
    }
  }
}

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> => new Promise<T>((resolve, reject) => { const t = setTimeout(() => reject(new Error(`${what} was not confirmed by the relay`)), ms); t.unref?.(); p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); }); });

/** What a branch-mode member's app needs from a bridge: built on the controller's own file-lock hub, so locks reach the team and the team's locks reach this person's agent. */
export function startBranchBridge(ctl: AppController, handle: SessionHandle, o: { shareActivity?: boolean; onChange?(): void; onConflict?(c: { agents: string[]; hmacs: string[] }): void; onError?(e: unknown): void; branchProbe?: BranchProbe } = {}): HostBridge {
  const bridge = new HostBridge(ctl, handle, { mode: 'branch', ...(ctl.lockHub ? { locks: ctl.lockHub } : {}), ...o }); bridge.start(); return bridge;
}

/** A joiner has the session's keys only once the host has granted them (state `live`); frames sent before that cannot be sealed. Resolves false after `ms`. */
export function untilLive(handle: SessionHandle, ms = 15_000): Promise<boolean> {
  if (handle.state === 'live') return Promise.resolve(true); if (handle.state === 'ended') return Promise.resolve(false);
  return new Promise((resolve) => { const t = setTimeout(() => { off(); resolve(false); }, ms); t.unref?.(); const off = handle.on('state', (st) => { if (st === 'live') { clearTimeout(t); off(); resolve(true); } else if (st === 'ended') { clearTimeout(t); off(); resolve(false); } }); });
}
