/** Finds the action for a key: the innermost focused context first, then global. Handles two-step chords with a 1 s timeout. One action per key event. */
import type { KeyContext } from './actions.js';
import type { Keymap } from './keymap.js';
import { formatStep, type KeyStep } from './parse.js';

export const CHORD_MS = 1000;
export interface DispatchClock { now(): number }
export type Dispatch = { kind: 'action'; action: string } | { kind: 'pending' } | { kind: 'none' };
export function createDispatcher(d: { keymap: Keymap; focus: () => KeyContext[]; clock: DispatchClock }) {
  let first: { key: string; at: number } | undefined;
  const lookup = (key: string): string | undefined => { for (const c of [...d.focus(), 'global' as const]) { const a = d.keymap.get(c)?.get(key); if (a) return a; } return undefined; };
  const startsChord = (key: string) => { const ctxs = [...d.focus(), 'global' as const]; for (const c of ctxs) for (const k of d.keymap.get(c)?.keys() ?? []) if (k.startsWith(key + ' ')) return true; return false; };
  return {
    handle(step: KeyStep): Dispatch {
      const key = formatStep(step); const now = d.clock.now();
      if (first && now - first.at <= CHORD_MS) { const a = lookup(`${first.key} ${key}`); first = undefined; if (a) return { kind: 'action', action: a }; } // a second key that does not finish the chord cancels it and counts on its own
      first = undefined;
      const direct = lookup(key); if (startsChord(key) && !direct) { first = { key, at: now }; return { kind: 'pending' }; }
      return direct ? { kind: 'action', action: direct } : { kind: 'none' };
    },
    pending: () => !!first && d.clock.now() - first.at <= CHORD_MS,
  };
}
