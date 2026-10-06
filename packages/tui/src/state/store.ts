/** A tiny external store: React reads it with useSyncExternalStore, the controller writes it from outside React. */
export class Store<S> {
  private listeners = new Set<() => void>();
  constructor(private state: S) {}
  get = (): S => this.state;
  set(patch: Partial<S> | ((s: S) => Partial<S>)) {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }
  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
}
