export class FleetError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = new.target.name; } }
/** A state name that is not in the contract's state map. Nothing was sent. */
export class UnknownStateError extends FleetError { constructor(state: string) { super('unknown_state', `"${state.slice(0, 40)}" is not an agent state.`); } }
/** A state only this screen uses (offline, reconnecting, quota-reached, teammate-...): it never goes on the wire. */
export class LocalStateError extends FleetError { constructor(state: string) { super('local_state', `"${state}" is only shown on this screen and is not shared.`); } }
/** The relay refused to start another agent (the plan's parallel-agent limit). The agent was not started. */
export class SpawnRejectedError extends FleetError { constructor(message = 'Your plan does not allow more agents at the same time.') { super('spawn_rejected', message); } }
export class NotMemberError extends FleetError { constructor() { super('not_member', 'You are not a member of this session.'); } }
