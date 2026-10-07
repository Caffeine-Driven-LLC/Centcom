/** Who may move: at most six canvases at a time (DESIGN.md 19.6); the rest hold their first frame and are promoted when one goes. A hidden tab or an off-screen canvas does not count and draws nothing. */
export const MAX_ANIMATING = 6;
export class MascotScheduler {
  private order: string[] = []; private hidden = new Set<string>(); private pageHidden = false; private fns = new Map<string, (animate: boolean) => void>(); private last = new Map<string, boolean>();
  constructor(private readonly cap = MAX_ANIMATING) {}
  register(id: string, onChange: (animate: boolean) => void): () => void { this.order.push(id); this.fns.set(id, onChange); this.recompute(); return () => { this.order = this.order.filter((x) => x !== id); this.fns.delete(id); this.last.delete(id); this.hidden.delete(id); this.recompute(); }; }
  setVisible(id: string, visible: boolean): void { if (visible) this.hidden.delete(id); else this.hidden.add(id); this.recompute(); }
  setPageHidden(h: boolean): void { this.pageHidden = h; this.recompute(); }
  animating(): string[] { if (this.pageHidden) return []; return this.order.filter((x) => !this.hidden.has(x)).slice(0, this.cap); }
  private recompute(): void { const on = new Set(this.animating()); for (const id of this.order) { const v = on.has(id); if (this.last.get(id) !== v) { this.last.set(id, v); this.fns.get(id)?.(v); } } }
}
export interface GateClock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void }
export const MIN_DWELL = 600; export const COLLAPSE_COUNT = 3; export const COLLAPSE_WINDOW = 2000; export const BRIDGE_MS = 200; export const COLLAPSED_STATE = 'tool-running';
/** The rules for changing what the mascot shows: a state stays for at least 600 ms, three changes within two seconds become one `tool-running`, and `prompt-received` is a bridge of at most 200 ms. The mascot only follows the real state; it never changes it. */
export class StateGate {
  private current?: string; private since = -Infinity; private pending?: string; private timer?: unknown; private changes: number[] = [];
  constructor(private readonly clock: GateClock, private readonly play: (state: string) => void) {}
  get shown(): string | undefined { return this.current; }
  request(state: string): void {
    const now = this.clock.now(); this.changes = this.changes.filter((t) => now - t < COLLAPSE_WINDOW); this.changes.push(now); const target = this.changes.length >= COLLAPSE_COUNT && state !== 'idle' && state !== 'ready' ? COLLAPSED_STATE : state;
    if (target === this.current && !this.pending) return; this.pending = target; const wait = this.since + MIN_DWELL - now; if (wait <= 0) return this.flush(); if (this.timer === undefined) this.timer = this.clock.setTimeout(() => { this.timer = undefined; this.flush(); }, wait);
  }
  private flush(): void { const s = this.pending; this.pending = undefined; if (s === undefined || s === this.current) return; this.current = s; this.since = this.clock.now(); this.play(s); }
  dispose(): void { if (this.timer !== undefined) this.clock.clearTimeout(this.timer); this.timer = undefined; this.pending = undefined; }
}
