import { describe, expect, it } from 'vitest';
import { STATES, STARTLING, isStartling, stateToAnimation } from '../../src/mascot/statemap.js';
import { all } from './helpers.js';

describe('every state has an animation (acceptance 1)', () => {
  const names = new Set(all.animations.map((a) => a.name));
  it('all keys of state-map.json resolve to an animation that exists', () => { expect(STATES().length).toBeGreaterThanOrEqual(61); for (const s of STATES()) { const a = stateToAnimation(s); expect(a.known, s).toBe(true); expect(names.has(a.name), `${s} -> ${a.name}`).toBe(true); } });
  it('an unknown state plays the thinking animation and says it was not known', () => { expect(stateToAnimation('state-from-the-future')).toEqual({ name: stateToAnimation('thinking').name, known: false }); expect(stateToAnimation('').known).toBe(false); expect(stateToAnimation('constructor').known).toBe(false); });
  it('the startling ones are named', () => { expect([...STARTLING].sort()).toEqual(['crash', 'glitch', 'panic']); expect(isStartling('crash', 'x')).toBe(true); expect(isStartling('idle', 'idle_breathe')).toBe(false); expect(isStartling('error', 'glitch_error')).toBe(true); });
});
