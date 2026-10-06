/** What we tell the session about our agents. */
import { STATE_NAMES } from '@centcom/protocol';
import { AGENT_WIRE_STATES } from '@centcom/protocol';
import { LocalStateError, UnknownStateError } from './errors.js';
const IN_MAP = new Set<string>(STATE_NAMES); const WIRE = new Set<string>(AGENT_WIRE_STATES);
/** Throws for a name that is not in the state map (`UnknownStateError`) or is only for this screen (`LocalStateError`). */
export function checkWireState(state: string): void { if (!IN_MAP.has(state)) throw new UnknownStateError(state); if (!WIRE.has(state)) throw new LocalStateError(state); }
export const STATE_GAP_MS = 500;
