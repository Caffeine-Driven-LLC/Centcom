/** What the queue client throws on purpose. The message is for people; `code` is stable. */
export class QueueError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = new.target.name; } }
export class NotHostError extends QueueError { constructor() { super('not_host', 'Only the host can do that.'); } }
export class NotAllowedError extends QueueError { constructor(readonly reason: 'viewer' | 'muted' | 'locked' | 'paused' | 'forbidden', message?: string) { super('not_allowed', message ?? ({ viewer: 'Viewers cannot add to the queue.', muted: 'You are muted, so you cannot add to the queue.', locked: 'The host has locked this session.', paused: 'The host paused the queue.', forbidden: 'You are not allowed to do that.' })[reason]); } }
export class QueueFullError extends QueueError { constructor(readonly scope: 'member' | 'session' = 'session') { super('queue_full', scope === 'member' ? 'You already have 5 items waiting. Wait for one to finish.' : 'The queue is full. Try again in a moment.'); } }
export class QueueItemTooLargeError extends QueueError { constructor() { super('too_large', 'That message is too large to queue (the limit is 192 KiB).'); } }
export class ItemGoneError extends QueueError { constructor() { super('item_gone', 'That item is no longer waiting: it was already handled.'); } }
export class UnknownItemError extends QueueError { constructor() { super('unknown_item', 'That item is not in the queue.'); } }
