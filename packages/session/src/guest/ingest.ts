/** Puts sequenced frames in order and drops duplicates: whatever the arrival order, `take` yields seq lastSeq+1, +2, ... (acceptance 4). */
export class GuestIngest<F extends { seq?: number }> {
  private pending = new Map<number, F>(); constructor(private last = 0, private readonly cap = 5000) {}
  get lastSeq(): number { return this.last; } get waiting(): number { return this.pending.size; }
  push(f: F): F[] {
    const seq = f.seq; if (typeof seq !== 'number' || !Number.isInteger(seq) || seq <= this.last || this.pending.has(seq)) return []; if (this.pending.size >= this.cap && seq > this.last + this.cap) return [];
    this.pending.set(seq, f); const out: F[] = []; for (let n = this.last + 1; this.pending.has(n); n++) { out.push(this.pending.get(n)!); this.pending.delete(n); this.last = n; } return out;
  }
  /** after a resume with a snapshot the base moves forward */
  rebase(seq: number): void { this.last = Math.max(this.last, seq); for (const k of [...this.pending.keys()]) if (k <= this.last) this.pending.delete(k); }
}
