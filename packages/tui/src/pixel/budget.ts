/** At most 6 mascots animate at once; the rest hold their first frame until a place frees up. */
export interface AnimationBudget { acquire(id: string): boolean; release(id: string): void; active(): number; subscribe(fn: () => void): () => void }
export function createAnimationBudget(max = 6): AnimationBudget {
  const ids = new Set<string>(); const waiting: string[] = []; const subs = new Set<() => void>();
  const tell = () => subs.forEach((f) => f());
  return {
    acquire(id) { if (ids.has(id)) return true; if (ids.size < max && !waiting.some((w) => w !== id)) { ids.add(id); return true; } if (ids.size < max && waiting[0] === id) { waiting.shift(); ids.add(id); return true; } if (!waiting.includes(id)) waiting.push(id); return false; },
    release(id) { const had = ids.delete(id); const i = waiting.indexOf(id); if (i >= 0) waiting.splice(i, 1); if (had) tell(); },
    active: () => ids.size, subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}
export const sharedBudget = createAnimationBudget();
