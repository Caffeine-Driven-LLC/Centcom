export { requestHandoff, onHostChanged, watchRole, HostActionGate, HANDOFF_TIMEOUT_MS, type HandoffOptions } from './handoff.js';
export { adoptQueue, ClaimLedger, type QueueItemLite } from './queue-continuity.js';
export { EpochTracker } from './epoch.js';
export { startPair, mergeSelections, PAIR_STATE, type PairHandle, type PairOptions } from './pair.js';
export { fromSessionHandle } from './adapter.js';
export type { HandoffSession, HandoffFrame, HandoffResult, HandoffProgress, MemberLite, HandoffClock, Observable, Selection, Unsubscribe, MemberId as HandoffMemberId, Role as HandoffRole } from './types.js';
