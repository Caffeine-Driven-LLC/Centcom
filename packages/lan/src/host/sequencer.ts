/** One counter for the whole session, starting at 1, plus the memory of which frame ids were already numbered (so a resend gets its old number). */
import { DEDUPE_MS } from './limits.js';
export class Sequencer {
  private n = 0; private seen = new Map<string, { seq: number; at: number }>();
  head(): number { return this.n; }
  next(): number { return ++this.n; }
  /** The seq a (member, frame id) pair already has, if any. */
  known(from: string, id: string, now: number): number | undefined { const k = `${from}:${id}`; const e = this.seen.get(k); if (!e) return undefined; if (now - e.at > DEDUPE_MS) { this.seen.delete(k); return undefined; } return e.seq; }
  remember(from: string, id: string, seq: number, now: number): void { this.seen.set(`${from}:${id}`, { seq, at: now }); if (this.seen.size > 50_000) { for (const [k, v] of this.seen) { if (now - v.at > DEDUPE_MS) this.seen.delete(k); if (this.seen.size <= 40_000) break; } } }
}
