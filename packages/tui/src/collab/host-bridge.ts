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
import type { AppController } from '../controller.js';
import type { Item } from '../state/model.js';

export interface HostBridgeOptions {
  /** run editors' requests without asking the host */ autoApprove?: boolean;
  /** called when the pending list, the roster or the sharing state changed */ onChange?(): void;
  onError?(e: unknown): void;
  /** the longest wait before streamed text goes out (default 100 ms) */ flushMs?: number;
}
export interface PendingRequest { item: string; from: string; slot: number; text: string; ts: string }
const ID_OK = { agt: /^agt_[0-9A-HJKMNP-TV-Z]{26}$/, apr: /^apr_[0-9A-HJKMNP-TV-Z]{26}$/, msg: /^msg_[0-9A-HJKMNP-TV-Z]{26}$/ } as const;
const RISKS = new Set(['low', 'medium', 'high']);

export class HostBridge {
  readonly queue: QueueClient;
  private readonly ids = newIdGenerator({ now: () => Date.now(), random: (n) => crypto.getRandomValues(new Uint8Array(n)) });
  private readonly mapped = new Map<string, string>(); private seen = new Set<string>(); private sentLen = new Map<string, number>(); private deltaIndex = new Map<string, number>(); private doneSent = new Set<string>();
  private toolSent = new Map<string, 'request' | 'result'>(); private approvals = new Set<string>(); private wasBusy = false; private chain: Promise<unknown> = Promise.resolve();
  private flushTimer?: ReturnType<typeof setTimeout>; private offStore?: () => void; private offTurn?: () => void; private stopped = false; private busyWaiters: (() => void)[] = []; private readonly stoppers = new Set<() => void>();
  private active?: { item: string; from: { name: string; slot: number } }; private working = false; private autoApprove: boolean; private tagNext?: string;
  constructor(private readonly ctl: AppController, private readonly handle: SessionHandle, private readonly o: HostBridgeOptions = {}) {
    this.autoApprove = o.autoApprove === true; this.queue = new QueueClient(handle);
  }

  start(): void {
    for (const i of this.ctl.state.items) { this.seen.add(i.id); if (i.kind === 'assistant') { this.sentLen.set(i.id, i.text.length); if (i.done) this.doneSent.add(i.id); } if (i.kind === 'tool') this.toolSent.set(i.id, i.status === 'running' ? 'request' : 'result'); }
    this.wasBusy = this.ctl.state.busy;
    this.offStore = this.ctl.store.subscribe(() => this.onState());
    this.offTurn = this.ctl.onTurnEnd(() => { void this.settle().then(() => this.emit('agent.state', { p: { agent_id: this.agent(), state: 'idle', since: new Date().toISOString() } })); });
    this.queue.on('changed', () => { this.o.onChange?.(); void this.pump(); }); this.queue.on('error', (e) => this.o.onError?.(e));
    this.handle.on('roster', () => this.o.onChange?.());
    this.emit('message.system', { secret: { level: 'info', text: 'This conversation is now shared.' } });
    void this.pump();
  }
  stop(): void { this.stopped = true; this.offStore?.(); this.offTurn?.(); this.queue.dispose(); if (this.flushTimer) clearTimeout(this.flushTimer); for (const w of this.busyWaiters.splice(0)) w(); for (const f of [...this.stoppers]) f(); }

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
  private emit(kind: string, body: { p?: Record<string, unknown>; secret?: Record<string, unknown> }): void {
    if (this.stopped) return; this.chain = this.chain.then(() => this.handle.sendEvent(kind, body as never)).catch((e) => this.o.onError?.(e));
  }

  private onState(): void {
    const st = this.ctl.state; const agent = this.agent();
    for (const it of st.items) this.item(it, agent);
    for (const a of st.approvals) { const id = a.req.approval_id; if (!this.approvals.has(id)) { this.approvals.add(id); this.emit('approval.request', { p: { approval_id: this.idOf('apr', id), agent_id: agent, risk: RISKS.has(a.req.risk) ? a.req.risk : 'medium', expires_at: new Date(a.expiresAt ?? Date.now() + 120_000).toISOString(), approver: 'host' }, secret: { summary: a.req.summary.slice(0, 2000), ...(a.req.command ? { command: a.req.command.slice(0, 2000) } : {}) } }); } }
    const live = new Set(st.approvals.map((a) => a.req.approval_id));
    for (const id of [...this.approvals]) if (!live.has(id)) { this.approvals.delete(id); const t = st.items.find((i) => i.kind === 'tool' && i.approval && (i as { approvalId?: string }).approvalId === id); this.emit('approval.decision', { p: { approval_id: this.idOf('apr', id), decision: t && (t as { approval?: string }).approval === 'denied' ? 'deny' : 'approve', scope: 'once' } }); }
    if (st.busy !== this.wasBusy) { this.wasBusy = st.busy; for (const w of this.busyWaiters.splice(0)) w(); }
  }
  private item(it: Item, agent: string): void {
    if (it.kind === 'user') {
      if (this.seen.has(it.id)) return; this.seen.add(it.id);
      const queueItem = it.member && this.tagNext ? this.tagNext : undefined; this.emit('agent.state', { p: { agent_id: agent, state: 'thinking', since: new Date().toISOString() } });
      this.emit('message.user', { secret: { text: it.text.slice(0, 60_000), agent_id: agent, ...(queueItem ? { queue_item: queueItem } : {}) } }); return;
    }
    if (it.kind === 'assistant') { this.seen.add(it.id); const sent = this.sentLen.get(it.id) ?? 0; if (it.text.length > sent || (it.done && !this.doneSent.has(it.id))) this.scheduleFlush(); return; }
    if (it.kind === 'tool') {
      const was = this.toolSent.get(it.id);
      if (!was) { this.toolSent.set(it.id, 'request'); this.emit('tool.request', { secret: { agent_id: agent, tool_id: it.toolId, name: it.name, input_summary: it.summary.slice(0, 4000), risk: RISKS.has(it.risk) ? it.risk : 'medium' } }); }
      if (it.status !== 'running' && this.toolSent.get(it.id) !== 'result') { this.toolSent.set(it.id, 'result'); this.emit('tool.result', { secret: { agent_id: agent, tool_id: it.toolId, status: it.status === 'ok' || it.status === 'error' || it.status === 'denied' || it.status === 'canceled' ? it.status : 'error', summary: (it.result ?? it.summary).slice(0, 4000) } }); }
      return;
    }
    if (it.kind === 'notice' && (it.level === 'warn' || it.level === 'error') && !this.seen.has(it.id)) { this.seen.add(it.id); this.emit('message.system', { secret: { level: it.level === 'error' ? 'error' : 'warn', text: it.text.slice(0, 2000) } }); }
  }
  private scheduleFlush(): void { if (this.flushTimer || this.stopped) return; this.flushTimer = setTimeout(() => { this.flushTimer = undefined; this.flush(); }, this.o.flushMs ?? 100); this.flushTimer.unref?.(); }
  private flush(): void {
    const agent = this.agent();
    for (const it of this.ctl.state.items) {
      if (it.kind !== 'assistant') continue; const mid = this.idOf('msg', it.messageId); const sent = this.sentLen.get(it.id) ?? 0;
      if (it.text.length > sent) { const delta = it.text.slice(sent); this.sentLen.set(it.id, it.text.length); const index = this.deltaIndex.get(it.id) ?? 0; this.deltaIndex.set(it.id, index + 1); this.emit('message.assistant.delta', { secret: { agent_id: agent, message_id: mid, index, delta: delta.slice(0, 60_000) } }); }
      if (it.done && !this.doneSent.has(it.id)) { this.doneSent.add(it.id); this.emit('message.assistant.done', { secret: { agent_id: agent, message_id: mid } }); }
    }
  }
}
