/** What `push` did with the value. */
export type PushResult = 'queued' | 'merged' | 'dropped';
/** A bounded queue (lane C101). While the consumer keeps up nothing changes. Past `max` waiting values a new one is first merged into the last waiting one when `merge` allows it (text deltas), then dropped when it is `droppable` (status chatter), and otherwise queued anyway: a value that matters is never lost. */
export interface QueueBounds<T> { max: number; merge?: (last: T, next: T) => boolean; droppable?: (v: T) => boolean }

/** Single-consumer async queue used for engine event streams. */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private done = false;
  constructor(private bounds?: QueueBounds<T>) {}
  /** Values waiting for the consumer. */
  get size(): number { return this.items.length; }
  push(v: T): PushResult {
    if (this.done) return 'dropped';
    const w = this.waiters.shift(); if (w) { w({ value: v, done: false }); return 'queued'; }
    const b = this.bounds;
    if (b && this.items.length >= b.max) {
      const last = this.items[this.items.length - 1]; if (last !== undefined && b.merge?.(last, v)) return 'merged';
      if (b.droppable?.(v)) return 'dropped';
    }
    this.items.push(v); return 'queued';
  }
  close() { this.done = true; for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true }); }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => {
      const v = this.items.shift();
      if (v !== undefined) return Promise.resolve({ value: v, done: false });
      if (this.done) return Promise.resolve({ value: undefined as never, done: true });
      return new Promise((res) => this.waiters.push(res));
    } };
  }
}
