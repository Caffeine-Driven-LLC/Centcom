export interface Candidate { id: string; owner: string; seq: number }
/**
 * Which waiting spawn starts next. Owners take turns: the owner with the fewest running agents goes first (ties go to whoever has waited longest), and nobody who is competing for a slot is
 * given more than `ceil(limit / competing owners)`, where the competing owners are those with a spawn waiting. That share can always be met when a slot is free (if every competing owner held
 * their share, no slot would be free), so no slot is left idle. An owner who is waiting for nothing keeps what they have; they are not preempted.
 */
export function pickNext(waiting: Candidate[], running: ReadonlyMap<string, number>, limit: number, alsoWaiting: readonly string[] = []): Candidate | undefined {
  if (!waiting.length) return undefined;
  const owners = new Set<string>([...waiting.map((w) => w.owner), ...alsoWaiting]); const cap = Math.max(1, Math.ceil(limit / owners.size));
  const heads = new Map<string, Candidate>(); for (const w of waiting) { const h = heads.get(w.owner); if (!h || w.seq < h.seq) heads.set(w.owner, w); }
  const order = (a: Candidate, b: Candidate) => (running.get(a.owner) ?? 0) - (running.get(b.owner) ?? 0) || a.seq - b.seq; const all = [...heads.values()].sort(order);
  return all.find((c) => (running.get(c.owner) ?? 0) < cap) ?? all[0];
}
