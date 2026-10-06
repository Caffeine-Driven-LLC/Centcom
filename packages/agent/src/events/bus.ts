/** A small typed in-process event bus. No global state: each owner creates its own with `createBus`. */
export type Unsubscribe = () => void;
/** Any return value is allowed and ignored (a Promise is watched for rejection). Wider than the lane card's `void | Promise<void>`, which would make `(p) => list.push(p)` a type error. */
export type Handler<P> = (p: P) => unknown;
export interface StreamOptions { buffer?: number; overflow?: 'drop-oldest' | 'drop-newest' }
export interface BusStream<K, P> extends AsyncIterableIterator<{ k: K; p: P }> { /** Events thrown away because the consumer was too slow. */ readonly dropped: number }

export interface EventBus<M extends Record<string, unknown>> {
  on<K extends keyof M>(k: K, h: Handler<M[K]>): Unsubscribe;
  once<K extends keyof M>(k: K, h: Handler<M[K]>): Unsubscribe;
  off<K extends keyof M>(k: K, h: Handler<M[K]>): void;
  /** Queues the event; handlers run in registration order, synchronously, unless this is called from inside a handler (then it runs after the current event finishes). */
  emit<K extends keyof M>(k: K, p: M[K]): void;
  /** Subscribes right away (so nothing between this call and the first `next()` is lost). Call `return()` or leave the `for await` to release it. */
  stream<K extends keyof M>(ks: readonly K[], o?: StreamOptions): BusStream<K, M[K]>;
  listenerCount(k?: keyof M): number;
}

export class BusError extends Error {
  constructor(readonly code: 'BusOverflow' | 'MaxListeners', message: string) { super(message); this.name = code; }
}

interface Entry { h: Handler<never>; once: boolean; active: boolean }
export interface BusOptions { onError: (e: unknown, k: string) => void; maxListeners?: number; maxQueue?: number }

export function createBus<M extends Record<string, unknown>>(o: BusOptions): EventBus<M> {
  const maxListeners = o.maxListeners ?? 100; const maxQueue = o.maxQueue ?? 10_000;
  // Copy-on-write lists: a dispatch walks the list as it was when the event started, so a listener added mid-dispatch waits for the next event.
  const lists = new Map<string, Entry[]>(); const warned = new Set<string>();
  let queue: { k: string; p: unknown }[] = []; let head = 0; let draining = false; let dropped = 0;
  const report = (e: unknown, k: string) => { try { o.onError(e, k); } catch { /* the error sink itself failed: nothing sensible left to do, and the bus must keep running */ } };

  function call(en: Entry, k: string, p: unknown) {
    if (!en.active) return; if (en.once) en.active = false;
    try { const r = (en.h as Handler<unknown>)(p); if (r && typeof (r as Promise<void>).then === 'function') (r as Promise<void>).then(undefined, (e) => report(e, k)); } catch (e) { report(e, k); }
  }
  function dispatch(k: string, p: unknown) {
    const list = lists.get(k); if (!list) return;
    for (let i = 0; i < list.length; i++) call(list[i]!, k, p);
    if (list.some((e) => e.once && !e.active)) prune(k);
  }
  function prune(k: string) { const l = (lists.get(k) ?? []).filter((e) => e.active); if (l.length) lists.set(k, l); else lists.delete(k); if (l.length <= maxListeners) warned.delete(k); }
  function add(k: string, h: Handler<never>, once: boolean): Unsubscribe {
    const en: Entry = { h, once, active: true }; const next = [...(lists.get(k) ?? []), en]; lists.set(k, next);
    if (next.length > maxListeners && !warned.has(k)) { warned.add(k); report(new BusError('MaxListeners', `More than ${maxListeners} listeners for "${k}"; this is probably a leak.`), k); }
    return () => { if (!en.active) return; en.active = false; prune(k); };
  }

  const bus: EventBus<M> = {
    on: (k, h) => add(k as string, h as Handler<never>, false),
    once: (k, h) => add(k as string, h as Handler<never>, true),
    off(k, h) { const l = lists.get(k as string); const en = l?.find((e) => e.h === (h as Handler<never>) && e.active); if (en) { en.active = false; prune(k as string); } },
    emit(k, p) {
      if (!draining) { // fast path: nothing is being delivered, so deliver now
        draining = true; try { dispatch(k as string, p); while (head < queue.length) { const ev = queue[head++]!; dispatch(ev.k, ev.p); } } finally { queue = []; head = 0; draining = false; } return;
      }
      if (queue.length - head >= maxQueue) { dropped++; if (dropped === 1 || dropped % 1000 === 0) report(new BusError('BusOverflow', `Event queue is full (${maxQueue}); ${dropped} dropped so far.`), k as string); return; }
      queue.push({ k: k as string, p });
    },
    stream(ks, so = {}) {
      const cap = Math.max(1, so.buffer ?? 1000); const mode = so.overflow ?? 'drop-oldest'; const buf: { k: (typeof ks)[number]; p: unknown }[] = []; const waiting: ((r: IteratorResult<never>) => void)[] = []; let done = false; let lost = 0;
      const unsubs = [...new Set(ks)].map((k) => bus.on(k, (p) => { if (done) return; const w = waiting.shift(); if (w) { (w as (r: IteratorResult<{ k: typeof k; p: unknown }>) => void)({ value: { k, p }, done: false }); return; }
        if (buf.length >= cap) { lost++; if (mode === 'drop-newest') return; buf.shift(); } buf.push({ k, p }); }));
      const finish = () => { if (done) return; done = true; unsubs.forEach((u) => u()); buf.length = 0; for (const w of waiting.splice(0)) w({ value: undefined as never, done: true }); };
      const it = {
        next: () => (buf.length ? Promise.resolve({ value: buf.shift()!, done: false as const }) : done ? Promise.resolve({ value: undefined, done: true as const }) : new Promise<IteratorResult<never>>((res) => { waiting.push(res); })),
        return: () => { finish(); return Promise.resolve({ value: undefined, done: true as const }); },
        throw: (e?: unknown) => { finish(); return Promise.reject(e); },
        get dropped() { return lost; },
        [Symbol.asyncIterator]() { return it; },
      };
      return it as unknown as BusStream<(typeof ks)[number], M[(typeof ks)[number]]>;
    },
    listenerCount(k) { if (k !== undefined) return (lists.get(k as string) ?? []).filter((e) => e.active).length; let n = 0; for (const l of lists.values()) n += l.filter((e) => e.active).length; return n; },
  };
  return bus;
}
