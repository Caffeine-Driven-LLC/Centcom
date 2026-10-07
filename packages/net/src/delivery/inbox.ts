/** Inbound ordering (CT-WS-ENVELOPE "Sequencing and delivery guarantees"): exactly once, strictly in seq order, with a bounded hold buffer for frames that overtook a gap.
 *  Pure: no timers, no I/O. Must not: deliver past a gap, hold more than `maxHold` frames, or remember more than `maxIds` ids. */
import type { Frame } from '@centcom/protocol';

export const MAX_HOLD = 1000;
export const MAX_DEDUPE_IDS = 5000;

/** A frame with a server seq (event, queue or control). */
export type SequencedFrame = Frame & { seq: number };
export type AcceptStatus = 'delivered' | 'duplicate' | 'held' | 'overflow';
export interface AcceptResult { status: AcceptStatus; /** frames now deliverable, in order (this one and any held ones it unblocked) */ delivered: SequencedFrame[] }

export const isSequencedType = (t: string): boolean => t === 'event' || t === 'queue' || t === 'control';

export class Inbox {
  private last: number | null = null;
  private readonly hold = new Map<number, SequencedFrame>();
  private readonly ids = new Map<string, true>();
  /** Snapshot pending: frames are held (not delivered) until setLastSeq(). Overflow then just drops: the resume after the snapshot replays them. */
  snapshotMode = false;
  constructor(private readonly o: { maxHold?: number; maxIds?: number } = {}) {}

  /** Highest seq delivered with nothing missing below it; null before the first frame of a fresh join. */
  get lastSeq(): number | null { return this.last; }
  get held(): number { return this.hold.size; }

  /** The lowest missing seq and the lowest held one, or null when nothing is held. */
  gap(): { expected: number; got: number } | null {
    if (this.hold.size === 0 || this.last === null) return null; let min = Infinity; for (const s of this.hold.keys()) if (s < min) min = s;
    return { expected: this.last + 1, got: min };
  }

  accept(f: SequencedFrame): AcceptResult {
    const seq = f.seq; const key = f.from && f.id ? `${f.from}:${f.id}` : undefined;
    if (this.last !== null && seq <= this.last) return { status: 'duplicate', delivered: [] };
    if (key && this.ids.has(key)) return { status: 'duplicate', delivered: [] };
    if (this.hold.has(seq)) return { status: 'duplicate', delivered: [] };
    if (this.snapshotMode) { if (this.hold.size < (this.o.maxHold ?? MAX_HOLD)) this.hold.set(seq, f); return { status: 'held', delivered: [] }; }
    if (this.last === null || seq === this.last + 1) { const out = [this.take(f)]; this.drain(out); return { status: 'delivered', delivered: out }; }
    if (this.hold.size >= (this.o.maxHold ?? MAX_HOLD)) return { status: 'overflow', delivered: [] };
    this.hold.set(seq, f); return { status: 'held', delivered: [] };
  }

  /** Move lastSeq (snapshot applied, history gap accepted): held frames at or below it are dropped, the ones now contiguous are returned for delivery. Leaves snapshot mode. */
  setLastSeq(seq: number | null): SequencedFrame[] {
    this.snapshotMode = false; this.last = seq; const out: SequencedFrame[] = [];
    if (seq === null) { this.hold.clear(); return out; }
    for (const s of [...this.hold.keys()]) if (s <= seq) this.hold.delete(s);
    this.drain(out); return out;
  }
  clearHold(): void { this.hold.clear(); }
  /** Forget everything (relay reset: start again from a fresh join). */
  reset(): void { this.last = null; this.hold.clear(); this.ids.clear(); this.snapshotMode = false; }

  private take(f: SequencedFrame): SequencedFrame {
    this.last = f.seq;
    if (f.from && f.id) { this.ids.set(`${f.from}:${f.id}`, true); if (this.ids.size > (this.o.maxIds ?? MAX_DEDUPE_IDS)) this.ids.delete(this.ids.keys().next().value!); }
    return f;
  }
  private drain(out: SequencedFrame[]): void {
    for (;;) { const next = this.last === null ? undefined : this.hold.get(this.last + 1); if (!next) break; this.hold.delete(next.seq); out.push(this.take(next)); }
  }
}
