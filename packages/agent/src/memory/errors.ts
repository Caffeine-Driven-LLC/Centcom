/** Refusals of the memory module. None of them contain any of the text that was refused. */
export class MemoryError extends Error { constructor(readonly code: 'secret_rejected' | 'too_large' | 'conflict' | 'plan_changed' | 'unreadable' | 'unsafe_path' | 'not_confirmed' | 'disabled' | 'no_path', message: string) { super(message); this.name = 'MemoryError'; } }
export class SecretRejected extends MemoryError { constructor() { super('secret_rejected', 'That text looks like a password or key, so it was not saved.'); this.name = 'SecretRejected'; } }
export class TooLarge extends MemoryError { constructor(readonly limit: number) { super('too_large', `That is larger than the ${limit} byte limit.`); this.name = 'TooLarge'; } }
/** The file changed after the plan was made. `newText` is what is on disk now, for a merge view; nothing was written. */
export class Conflict extends MemoryError { constructor(readonly newText: string, message = 'The file changed since the plan was made.') { super('conflict', message); this.name = 'Conflict'; } }
export class PlanChanged extends MemoryError { constructor() { super('plan_changed', 'The confirmation does not match this plan.'); this.name = 'PlanChanged'; } }
