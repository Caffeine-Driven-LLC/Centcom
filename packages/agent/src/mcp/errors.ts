export type McpErrorCode = 'secret_rejected' | 'builtin' | 'plan_changed' | 'invalid_config' | 'invalid_server' | 'unsupported' | 'not_confirmed' | 'needs_user_confirm' | 'not_found' | 'exists';
/** Refusals of the MCP manager. None of them contains a secret or the text that was refused. */
export class McpError extends Error { constructor(readonly code: McpErrorCode, message: string, readonly detail?: string) { super(message); this.name = 'McpError'; } }
export class McpSecretRejected extends McpError { constructor() { super('secret_rejected', 'That value looks like a password or key. Use an environment variable reference instead, so Centcom never stores it.'); this.name = 'SecretRejected'; } }
export class BuiltinServer extends McpError { constructor() { super('builtin', 'That is Centcom\'s own approvals server. It cannot be changed or removed.'); this.name = 'BuiltinServer'; } }
export class McpPlanChanged extends McpError { constructor() { super('plan_changed', 'The file changed since the plan was made, or the confirmation does not match. Nothing was written.'); this.name = 'PlanChanged'; } }
export class InvalidConfig extends McpError { constructor(file: string, pos?: string) { super('invalid_config', `The ${file} file is not valid, so it was not edited${pos ? ` (${pos})` : ''}.`, pos); this.name = 'InvalidConfig'; } }
