/** Resume bookkeeping (CT-RESUME): which seqs a replay must bring, and checking `sys.resumed` against what actually arrived.
 *  Pure. Must not: deliver frames or talk to the link. */

/** Never remembers more replayed seqs than this (the relay's hot buffer is 5 000; leave room). */
export const MAX_TRACKED = 20_000;

export type ResumedOutcome =
  | { kind: 'ok'; fromSeq: number; toSeq: number; count: number; historyGap: boolean }
  | { kind: 'snapshot'; snapshotSeq: number }
  | { kind: 'mismatch'; expected: number; got: number }
  | { kind: 'reset'; toSeq: number }
  | { kind: 'invalid' };

const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export class ResumeTracker {
  private pending: { from: number; seen: Set<number> } | null = null;
  /** A resume from `lastSeq` was asked for (hello carried it, or we sent sys.resume). */
  begin(lastSeq: number): void { this.pending = { from: lastSeq + 1, seen: new Set() }; }
  get active(): boolean { return this.pending !== null; }
  /** A sequenced frame arrived (any source); replayed ones are counted. */
  note(seq: number): void { const p = this.pending; if (p && seq >= p.from && p.seen.size < MAX_TRACKED) p.seen.add(seq); }
  cancel(): void { this.pending = null; }

  /** Check a `sys.resumed` body. `lastSeq` is the channel's after processing the replay. */
  finish(body: unknown, lastSeq: number | null): ResumedOutcome {
    const p = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>; const pend = this.pending; this.pending = null;
    if (p.snapshot_required === true) return int(p.snapshot_seq) && p.snapshot_seq >= 0 ? { kind: 'snapshot', snapshotSeq: p.snapshot_seq } : { kind: 'invalid' };
    if (!int(p.from_seq) || !int(p.to_seq) || !int(p.count) || p.count < 0) return { kind: 'invalid' };
    const from = p.from_seq, to = p.to_seq, count = p.count;
    if (lastSeq !== null && to < lastSeq) return { kind: 'reset', toSeq: to };
    const span = to >= from ? to - from + 1 : 0;
    if (count !== span) return { kind: 'mismatch', expected: span, got: count };
    if (pend) { let got = 0; for (const s of pend.seen) if (s >= from && s <= to) got++; if (got !== count) return { kind: 'mismatch', expected: count, got }; }
    const historyGap = p.history_gap === true || (pend !== null && from > pend.from);
    return { kind: 'ok', fromSeq: from, toSeq: to, count, historyGap };
  }
}
