/**
 * The host's agent behind the host engine (lane C075): approved queue items are run, one at a time, by an agent from the runner, and the agent's events go out as session events.
 *
 *   engine: approved item at the front -> `claim` -> agent runs it (the first one starts the agent, later ones are sent to it) -> turn done -> `queue.done`
 *   bus:    the agent's events become wire events (`toSessionWire`) for `publish`, which seals and sends them (the engine itself never encrypts or reads `ct`)
 *
 * The item's text is `ct`, so the engine cannot give it out: `open` is the host's own reader of it (its session codec). An item `open` cannot read is rejected, not run.
 * Only the member who is host in the roster claims: after a transfer or a failover this bridge is idle and the new host's own bridge runs the queue.
 * Must not: read or log an item's text beyond handing it to the agent, claim an item twice, or run two items at once.
 */
import { toSessionWire, type AgentBus, type AgentHandle, type AgentRunner, type AgentSpec, type WireContext, type WireOut } from '@centcom/agent';
import { newIdGenerator } from '@centcom/protocol';
import type { HostSessionEngine } from './engine.js';

export interface RunnerBridgeOptions {
  engine: Pick<HostSessionEngine, 'queue' | 'members' | 'claim' | 'complete' | 'rejectItem' | 'on'>;
  runner: AgentRunner; bus: AgentBus;
  /** the member id this bridge acts for: it only runs the queue while this member is the host */ hostId: string;
  /** how the agent is started (the first item's text becomes its prompt) */ spec: Omit<AgentSpec, 'prompt' | 'id'>;
  /** the host's own reader of an item's text (its session codec); null when it cannot be read */ open(item: { item: string; submitter: string }): Promise<string | null>;
  /** sends a wire event to the session (the caller seals and signs it) */ publish?(out: WireOut): unknown;
  onError?(e: unknown): void; now?(): Date;
}
type View = { item: string; submitter: string; state: string };

export class HostRunnerBridge {
  private readonly ids = newIdGenerator({ now: () => Date.now(), random: (n) => crypto.getRandomValues(new Uint8Array(n)) });
  private handle?: AgentHandle; private agentId?: string; private current?: { item: string }; private pumping = false; private stopped = false; private offs: (() => unknown)[] = []; private readonly msg = new Map<string, string>();
  constructor(private readonly o: RunnerBridgeOptions) {}

  start(): void {
    const bus = this.o.bus; const pump = (): void => { void this.pump(); };
    this.offs.push(this.o.engine.on('queue-changed', pump), this.o.engine.on('host-changed', pump),
      bus.on('agent:event', (p) => { if (p.agent_id !== this.agentId) return; this.forward(p.event); if (p.event.type === 'turn.done') this.finish('ok'); }),
      bus.on('agent:exited', (p) => { if (p.agent_id !== this.agentId) return; this.handle = undefined; this.finish(p.outcome === 'ok' ? 'ok' : p.outcome === 'canceled' ? 'canceled' : 'error'); }));
    pump();
  }
  stop(): void { this.stopped = true; for (const o of this.offs.splice(0)) o(); }
  /** the item being run, if any */ running(): string | undefined { return this.current?.item; }
  private isHost(): boolean { return this.o.engine.members().find((m) => m.id === this.o.hostId)?.role === 'host'; }

  private forward(ev: Parameters<typeof toSessionWire>[0]): void {
    if (!this.o.publish || !this.agentId) return;
    const ctx: WireContext = { agentId: this.agentId, messageId: (k) => { let v = this.msg.get(k); if (!v) { v = this.ids.next('msg'); this.msg.set(k, v); if (this.msg.size > 500) this.msg.delete(this.msg.keys().next().value as string); } return v; }, approverFor: () => 'host', approvalTtlMs: 600_000, now: () => this.o.now?.() ?? new Date() };
    for (const out of toSessionWire(ev, ctx)) { try { const r = this.o.publish(out); if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch((e) => this.o.onError?.(e)); } catch (e) { this.o.onError?.(e); } }
  }
  private finish(outcome: 'ok' | 'error' | 'canceled'): void {
    const cur = this.current; if (!cur) return; this.current = undefined;
    void this.o.engine.complete(cur.item, outcome).catch((e: unknown) => this.o.onError?.(e)).finally(() => { void this.pump(); });
  }
  private next(): View | undefined { return (this.o.engine.queue().items as View[]).find((i) => i.state === 'approved'); }

  private async pump(): Promise<void> {
    if (this.pumping || this.stopped || this.current) return; this.pumping = true;
    try {
      while (!this.stopped && !this.current && this.isHost()) {
        const it = this.next(); if (!it) return;
        const text = await this.o.open({ item: it.item, submitter: it.submitter }).catch(() => null);
        if (this.stopped || !this.isHost()) return; if (this.next()?.item !== it.item) continue; /* it changed while the text was being read */
        if (text === null) { await this.o.engine.rejectItem(it.item, 'other').catch((e: unknown) => this.o.onError?.(e)); await this.untilGone(it.item); continue; }
        const agent = this.handle && this.handle.status() !== 'exited' ? this.handle.id : this.ids.next('agt'); this.agentId = agent; this.current = { item: it.item };
        await this.o.engine.claim(it.item, agent); if (!(await this.untilState(it.item, 'running'))) { this.current = undefined; continue; }
        try { if (this.handle && this.handle.status() !== 'exited') await this.handle.send(text); else { this.handle = await this.o.runner.start({ ...this.o.spec, id: agent as never, prompt: text }); } } catch (e) { this.o.onError?.(e); this.finish('error'); }
        return; /* the turn ends through the bus, which calls `finish`, which pumps again */
      }
    } catch (e) { this.o.onError?.(e); } finally { this.pumping = false; }
  }
  private untilState(item: string, state: string, ms = 5000): Promise<boolean> {
    const at = (): string | undefined => (this.o.engine.queue().items as View[]).find((i) => i.item === item)?.state;
    if (at() === state) return Promise.resolve(true);
    return new Promise((res) => { let done = false; const end = (v: boolean): void => { if (done) return; done = true; clearTimeout(t); off(); res(v); }; const t = setTimeout(() => end(at() === state), ms); const off = this.o.engine.on('queue-changed', () => { if (at() === state) end(true); else if (at() === undefined) end(false); }) as () => void; });
  }
  private untilGone(item: string): Promise<boolean> { const gone = (): boolean => !(this.o.engine.queue().items as View[]).some((i) => i.item === item && i.state === 'approved'); if (gone()) return Promise.resolve(true); return new Promise((res) => { const t = setTimeout(() => { off(); res(gone()); }, 3000); const off = this.o.engine.on('queue-changed', () => { if (gone()) { clearTimeout(t); off(); res(true); } }) as () => void; }); }
}
