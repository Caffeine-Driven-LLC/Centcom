/** Single-consumer async queue used for engine event streams. */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private done = false;
  push(v: T) { if (this.done) return; const w = this.waiters.shift(); if (w) w({ value: v, done: false }); else this.items.push(v); }
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
