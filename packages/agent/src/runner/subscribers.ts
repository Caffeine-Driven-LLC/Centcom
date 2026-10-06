import type { AgentEvent } from './types.js';

/** Events a slow reader may lose. Everything else (approvals, tool results, turn and lifecycle events) is kept. */
const DROPPABLE = new Set(['text.delta', 'thinking.delta', 'subagent.text', 'status', 'usage.report', 'limits.report']);
/** If a reader falls this far behind even on events that must not be dropped, the oldest are cut and counted. It is a memory bound, not a policy. */
const HARD_FACTOR = 10;

/** A bounded queue for one reader of one agent's events. */
export class Subscriber {
  private items: AgentEvent[] = []; private waiting?: (r: IteratorResult<AgentEvent>) => void; private closed = false;
  dropped = 0; forced = 0;
  constructor(private cap: number, private onClose: () => void) {}

  push(e: AgentEvent) {
    if (this.closed) return;
    if (this.waiting) { const w = this.waiting; this.waiting = undefined; w({ value: e, done: false }); return; }
    this.items.push(e);
    if (this.items.length > this.cap) {
      const i = this.items.findIndex((x) => DROPPABLE.has(x.event.type));
      if (i >= 0) { this.items.splice(i, 1); this.dropped++; }
      else if (this.items.length > this.cap * HARD_FACTOR) { this.items.shift(); this.forced++; }
    }
  }
  close() { if (this.closed) return; this.closed = true; this.items = []; this.onClose(); if (this.waiting) { const w = this.waiting; this.waiting = undefined; w({ value: undefined as never, done: true }); } }
  /** Lets the reader drain what is queued, then ends. */
  end() { if (this.closed) return; if (!this.items.length) return this.close(); this.draining = true; }
  private draining = false;
  size() { return this.items.length; }

  iterator(): AsyncIterableIterator<AgentEvent> {
    const it: AsyncIterableIterator<AgentEvent> = {
      next: () => {
        if (this.items.length) { const v = this.items.shift()!; if (this.draining && !this.items.length) queueMicrotask(() => this.close()); return Promise.resolve({ value: v, done: false }); }
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((res) => { this.waiting = res; });
      },
      return: () => { this.close(); return Promise.resolve({ value: undefined as never, done: true }); },
      [Symbol.asyncIterator]() { return it; },
    };
    return it;
  }
}
