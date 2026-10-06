export type HooksErrorCode = 'settings_invalid' | 'plan_changed' | 'not_confirmed' | 'needs_user_confirm' | 'capability_missing' | 'invalid_hook' | 'too_many' | 'secret_rejected' | 'unwritable' | 'not_found';
/** Refusals of the hooks manager. None of them contains a command, a path to a secret, or text from a settings file. */
export class HooksError extends Error { constructor(readonly code: HooksErrorCode, message: string, readonly detail?: string) { super(message); this.name = 'HooksError'; } }
export class SettingsInvalid extends HooksError { constructor(file: string, why?: string) { super('settings_invalid', `The ${file} file is too large or is not valid JSON, so it was not touched${why ? ` (${why})` : ''}.`, why); this.name = 'SettingsInvalid'; } }
export class HooksPlanChanged extends HooksError { constructor() { super('plan_changed', 'The file changed since the plan was made, or the confirmation does not match. Nothing was written.'); this.name = 'PlanChanged'; } }
export class CapabilityMissing extends HooksError { constructor(what: string) { super('capability_missing', what); this.name = 'CapabilityMissing'; } }
