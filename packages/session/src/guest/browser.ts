/** The browser-safe part of the guest engine: the reducer, ordering and the key-wait buffer (no transports, no Node modules). */
export { reduceGuestState } from './reduce.js';
export { GuestIngest } from './ingest.js';
export { KeyWaitBuffer, KEY_WAIT_FRAMES, KEY_WAIT_BYTES } from './key-wait.js';
export { initialGuestState, SERVER, WARNING_RING, type GuestState, type Phase, type QueueItemView, type TranscriptEntry, type ProtocolWarning, type DecodedFrame, type Role as GuestRole, type RosterEntry as GuestRosterEntry } from './state.js';
