import stateMap from '../../../../contracts/state-map.json';
export const FALLBACK = 'thinking';
const map = stateMap as Record<string, string>; const known = (s: string): boolean => Object.prototype.hasOwnProperty.call(map, s);
/** Which animation plays for a product state (CT-STATE-MAP). An unknown state plays the `thinking` one and says so. */
export function stateToAnimation(state: string): { name: string; known: boolean } { return known(state) ? { name: map[state]!, known: true } : { name: map[FALLBACK]!, known: false }; }
export const STATES = (): string[] => Object.keys(map);
/** These never start by themselves under reduced motion. */
export const STARTLING = new Set(['crash', 'glitch', 'panic']);
export const isStartling = (state: string, animation: string): boolean => STARTLING.has(state) || [...STARTLING].some((s) => animation.includes(s));
