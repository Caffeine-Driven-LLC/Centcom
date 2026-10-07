/** The recent frames, kept in memory so a guest that dropped can be given what it missed: at least `minFrames` of them, and everything younger than `minMs`. */
import type { Frame } from '@centcom/protocol';
export class ReplayBuffer {
  private items: { f: Frame; at: number }[] = [];
  constructor(private readonly minFrames: number, private readonly minMs: number) {}
  push(f: Frame, now: number): void { this.items.push({ f, at: now }); let drop = 0; while (this.items.length - drop > this.minFrames && now - this.items[drop]!.at >= this.minMs) drop++; if (drop) this.items.splice(0, drop); }
  /** The oldest seq still held, or undefined when empty. */
  oldest(): number | undefined { return this.items[0]?.f.seq; }
  size(): number { return this.items.length; }
  /** Frames after `seq`, in order. */
  after(seq: number): Frame[] { const out: Frame[] = []; for (const { f } of this.items) if ((f.seq ?? 0) > seq) out.push(f); return out; }
  bySeq(seq: number): Frame | undefined { return this.items.find((x) => x.f.seq === seq)?.f; }
}
