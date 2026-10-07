export class ControlError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = new.target.name; } }
/** Only the host can do that. Nothing was sent. */
export class NotHostError extends ControlError { constructor() { super('not_host', 'Only the host can do that.'); } }
/** The relay (or the local rules) said you may not. */
export class ForbiddenError extends ControlError { constructor(message = 'You are not allowed to do that.') { super('forbidden', message); } }
export class InvalidPolicyError extends ControlError { constructor(readonly problems: string[]) { super('invalid_policy', `That policy is not valid: ${problems.join(', ')}.`); } }
export class SelfActionError extends ControlError { constructor(what: string) { super('self_action', `You cannot ${what} yourself.`); } }
