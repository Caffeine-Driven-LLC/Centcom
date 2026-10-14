/** The product-state to animation table of CT-STATE-MAP, read from the contract file itself. */
import stateMap from '../../../../contracts/state-map.json' with { type: 'json' };

export const STATE_MAP: Record<string, string> = stateMap as Record<string, string>;
/** The animation for a state; one this client does not know plays the `thinking` one. */
export const animationForState = (state: string): string => STATE_MAP[state] ?? STATE_MAP.thinking ?? 'thinking';
