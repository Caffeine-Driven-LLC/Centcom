/** Time for the mock. `virtual` only moves when a test says so, which is what makes runs repeatable. Nothing in the mock may call Date.now() or setTimeout directly. */
export interface TimerHandle { id: number }
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle; clearTimeout(h: TimerHandle | undefined): void;
  setInterval(fn: () => void, ms: number): TimerHandle; clearInterval(h: TimerHandle | undefined): void;
  readonly kind: 'real' | 'virtual';
}

export class VirtualClock implements Clock {
  readonly kind = 'virtual' as const; private t: number; private seq = 0; private timers = new Map<number, { at: number; fn: () => void; every?: number; order: number }>(); private order = 0;
  constructor(start = Date.UTC(2026, 9, 5, 18, 0, 0)) { this.t = start; }
  now() { return this.t; }
  setTimeout(fn: () => void, ms: number): TimerHandle { const id = ++this.seq; this.timers.set(id, { at: this.t + Math.max(0, ms), fn, order: ++this.order }); return { id }; }
  setInterval(fn: () => void, ms: number): TimerHandle { const id = ++this.seq; this.timers.set(id, { at: this.t + Math.max(1, ms), fn, every: Math.max(1, ms), order: ++this.order }); return { id }; }
  clearTimeout(h?: TimerHandle) { if (h) this.timers.delete(h.id); } clearInterval(h?: TimerHandle) { this.clearTimeout(h); }
  /** Move time forward, firing every timer that comes due in order (ties in creation order). Yields to the event loop after each so sockets can flush. */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void; every?: number; order: number }] | undefined;
      for (const e of this.timers) if (e[1].at <= target && (!next || e[1].at < next[1].at || (e[1].at === next[1].at && e[1].order < next[1].order))) next = e;
      if (!next) break; const [id, tm] = next; this.t = Math.max(this.t, tm.at);
      if (tm.every) { tm.at += tm.every; tm.order = ++this.order; } else this.timers.delete(id);
      tm.fn(); await new Promise<void>((r) => setImmediate(r));
    }
    this.t = target; await new Promise<void>((r) => setImmediate(r));
  }
  pending(): number { return this.timers.size; }
}

export class RealClock implements Clock {
  readonly kind = 'real' as const; private seq = 0; private h = new Map<number, NodeJS.Timeout>();
  now() { return Date.now(); }
  setTimeout(fn: () => void, ms: number): TimerHandle { const id = ++this.seq; const t = setTimeout(() => { this.h.delete(id); fn(); }, ms); t.unref?.(); this.h.set(id, t); return { id }; }
  setInterval(fn: () => void, ms: number): TimerHandle { const id = ++this.seq; const t = setInterval(fn, ms); t.unref?.(); this.h.set(id, t); return { id }; }
  clearTimeout(x?: TimerHandle) { if (x) { const t = this.h.get(x.id); if (t) { clearTimeout(t); clearInterval(t); this.h.delete(x.id); } } } clearInterval(x?: TimerHandle) { this.clearTimeout(x); }
}
