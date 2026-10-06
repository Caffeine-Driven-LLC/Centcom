export type LockErrorCode = 'held' | 'path_outside_root' | 'timeout';
/** Refusals of the lock client. They never carry a path. */
export class LockError extends Error { constructor(readonly code: LockErrorCode, message: string) { super(message); this.name = 'LockError'; } }
export class LockHeld extends LockError { constructor(readonly heldBy: string, readonly expiresAt: string) { super('held', 'Another agent holds this file right now.'); this.name = 'LockHeld'; } }
export class PathOutsideRoot extends LockError { constructor() { super('path_outside_root', 'That path is outside the agent\'s working folder.'); this.name = 'PathOutsideRoot'; } }
