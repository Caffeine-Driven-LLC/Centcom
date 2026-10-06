/** Chooses the words next to the spinner: context pools by state, a shuffle bag so nothing repeats until all were used, plain words where a joke would be wrong. */
import lines from './lines.json' with { type: 'json' };
import cfg from './pools.json' with { type: 'json' };

export type PoolName = keyof typeof cfg.pools;
const SERIOUS = new Set<string>(cfg.serious);
export const isSeriousState = (state: string): boolean => SERIOUS.has(state);
export function poolForState(state: string): PoolName { return ((cfg.states as Record<string, string>)[state] ?? 'Default') as PoolName; }
/** The wording for states where a joke would be wrong. */
export function plainVerb(state: string): string { const p = cfg.plain as Record<string, string>; return p[state] ?? p.default!; }
/** A new line every 3 to 6 s, never faster than 3 s. */
export const nextVerbDelayMs = (rng: () => number): number => 3000 + Math.floor(rng() * 3000);
export const ABSURD_AFTER_MS = 30_000;
export const MAX_VERB = 40; export const MAX_VERB_NARROW = 24;

function members(pool: PoolName, all: readonly string[]): string[] {
  const words = (cfg.pools as Record<string, { words?: string[] }>)[pool]?.words; if (!words) return [...all];
  const m = all.filter((l) => { const t = l.toLowerCase(); return words.some((w) => t.includes(w)); }); return m.length >= 5 ? m : [...all];
}
export interface PickCtx { state: string; elapsedMs: number; width: number; serious: boolean }
export interface VerbPicker { next(ctx: PickCtx): string }
export function createVerbPicker(deps: { rng: () => number; plain?: boolean; lines?: readonly string[] }): VerbPicker {
  const all = deps.lines ?? lines; const bags = new Map<string, string[]>();
  return {
    next(ctx) {
      if (deps.plain) return 'Working…'; if (ctx.serious || isSeriousState(ctx.state)) return plainVerb(ctx.state);
      const pool: PoolName = ctx.elapsedMs >= ABSURD_AFTER_MS ? 'Absurd' : poolForState(ctx.state); const max = ctx.width < 60 ? MAX_VERB_NARROW : MAX_VERB; const key = `${pool}:${max}`;
      let bag = bags.get(key);
      if (!bag?.length) { bag = members(pool, all).filter((l) => l.length <= max); for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(deps.rng() * (i + 1)); [bag[i], bag[j]] = [bag[j]!, bag[i]!]; } bags.set(key, bag); }
      return bag.pop() ?? 'Working…';
    },
  };
}
