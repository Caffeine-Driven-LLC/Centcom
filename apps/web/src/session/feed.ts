/**
 * Puts the frames of a session in order for a person who may have joined in the middle of it. The view starts at the first frame it has (the
 * session's history is fetched first, when the host keeps it for them), frames are handed on in order without duplicates, and a frame that
 * this person is not sent (the relay does not send everything to everyone) leaves a gap: after `gapMs` the view goes on without it.
 */
export class TailFeed<F extends { seq?: number }> {
  private pending = new Map<number, F>(); private last = 0; private held: F[] | undefined = []; private timer: unknown;
  constructor(private readonly out: (frames: F[]) => void, private readonly o: { gapMs?: number; setTimeout?: (fn: () => void, ms: number) => unknown; clearTimeout?: (h: unknown) => void } = {}) {}
  private st(fn: () => void, ms: number): unknown { return (this.o.setTimeout ?? ((f, m) => setTimeout(f, m)))(fn, ms); }
  /** A frame from the session or from history. Frames before `release()` are kept so history and live frames can be put together first. */
  push(f: F): void { if (this.held) { this.held.push(f); return; } this.feed([f]); }
  /** The frames that were already there have been added: start. */
  release(): void { const frames = this.held ?? []; this.held = undefined; this.feed(frames); }
  get waiting(): number { return this.pending.size; }
  stop(): void { if (this.timer !== undefined) (this.o.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer); this.timer = undefined; }
  private feed(frames: F[]): void {
    for (const f of frames) { const seq = f.seq; if (typeof seq !== 'number' || !Number.isInteger(seq) || seq <= this.last || this.pending.has(seq)) continue; this.pending.set(seq, f); }
    if (this.last === 0 && this.pending.size) this.last = Math.min(...this.pending.keys()) - 1; this.drain();
  }
  private drain(): void {
    const out: F[] = []; for (let n = this.last + 1; this.pending.has(n); n++) { out.push(this.pending.get(n)!); this.pending.delete(n); this.last = n; }
    if (out.length) this.out(out);
    if (this.pending.size && this.timer === undefined) this.timer = this.st(() => { this.timer = undefined; if (!this.pending.size) return; this.last = Math.min(...this.pending.keys()) - 1; this.drain(); }, this.o.gapMs ?? 800);
  }
}
