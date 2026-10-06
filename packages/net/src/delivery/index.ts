/** Public surface of reliable delivery (lane C055). Other lanes import from here, never from the files behind it. */
export { ReliableChannel, HOLD_MS, type ReliableChannelOptions, type ChannelEvents, type SendDraft, type EphemeralDraft } from './channel.js';
export { Outbox, OutboxFullError, MAX_UNACKED, MAX_UNACKED_BYTES, RESEND_AFTER_MS, MAX_RESENDS, type OutboxEntry } from './outbox.js';
export { Inbox, MAX_HOLD, MAX_DEDUPE_IDS, isSequencedType, type SequencedFrame, type AcceptResult, type AcceptStatus } from './inbox.js';
export { AckScheduler, ACK_EVERY, ACK_MAX_DELAY_MS } from './ack-scheduler.js';
export { ResumeTracker, type ResumedOutcome } from './resume.js';
export { memorySeqStore, type SeqStore } from './seq-store.js';
export { createMsgIdGenerator, isMsgId, MSG_ID_RE, type IdGenerator } from './ulid.js';
