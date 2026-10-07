/** Where `lastSeq` lives between process runs. The default keeps it in memory; lane C063 supplies a disk-backed one.
 *  Must not: store anything but the session id and a number. */

export interface SeqStore { load(sid: string): Promise<number | null>; save(sid: string, seq: number): Promise<void> }

/** In-memory store (the default). `initial` seeds it for tests. */
export function memorySeqStore(initial: Record<string, number> = {}): SeqStore & { snapshot(): Record<string, number> } {
  const m = new Map(Object.entries(initial));
  return {
    load: async (sid) => m.get(sid) ?? null,
    save: async (sid, seq) => { if (Number.isInteger(seq) && seq >= 0) m.set(sid, seq); },
    snapshot: () => Object.fromEntries(m),
  };
}
