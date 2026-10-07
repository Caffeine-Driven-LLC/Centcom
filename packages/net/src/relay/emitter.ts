/** A small typed event emitter shared by the relay client and the delivery channel.
 *  Must not: let a throwing listener break the emitter or the other listeners. */

export class TypedEmitter<E extends { [K in keyof E]: unknown[] }> {
  private m = new Map<keyof E, Set<(...a: unknown[]) => void>>();
  /** `onListenerError` hears the event name of a listener that threw (never the error, which may carry data). */
  constructor(private readonly onListenerError: (ev: string) => void = () => undefined) {}
  /** Subscribe; the returned function unsubscribes. */
  on<K extends keyof E>(ev: K, fn: (...a: E[K]) => void): () => void {
    const f = fn as unknown as (...a: unknown[]) => void; let s = this.m.get(ev); if (!s) this.m.set(ev, (s = new Set())); s.add(f); return () => { s!.delete(f); };
  }
  protected emit<K extends keyof E>(ev: K, ...a: E[K]): void {
    for (const fn of [...(this.m.get(ev) ?? [])]) { try { fn(...a); } catch { this.onListenerError(String(ev)); } }
  }
}
