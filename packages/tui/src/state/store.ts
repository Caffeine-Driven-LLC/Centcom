/** A tiny external store: React reads it with useSyncExternalStore, the controller writes it from outside React.
 *  State is updated immediately; listeners are told at most every `minGapMs` (leading edge at once, then one trailing
 *  notification), so a burst of streamed tokens becomes one repaint instead of dozens. */
export class Store<S> {
  private listeners = new Set<() => void>();
  private last = 0; private timer?: NodeJS.Timeout; private dirty = false;
  constructor(private state: S, private minGapMs = 24) {}
  get = (): S => this.state;
  /** `urgent` (typing) tells listeners at once instead of waiting for the gap, so a key never queues behind streamed text. */
  set(patch: Partial<S> | ((s: S) => Partial<S>), urgent = false) {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    if (urgent) { if (this.timer) { clearTimeout(this.timer); this.timer = undefined; } this.flush(); return; }
    this.schedule();
  }
  private schedule() {
    const wait = this.last + this.minGapMs - Date.now();
    if (wait <= 0 && !this.timer) { this.flush(); return; }
    this.dirty = true;
    if (!this.timer) { this.timer = setTimeout(() => { this.timer = undefined; if (this.dirty) this.flush(); }, Math.max(1, wait)); this.timer.unref?.(); }
  }
  private flush() { this.dirty = false; this.last = Date.now(); for (const l of this.listeners) l(); }
  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
}
