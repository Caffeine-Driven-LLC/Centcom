export type RunnerErrorCode = 'runner_busy' | 'cwd_in_use' | 'cwd_invalid' | 'queue_full' | 'engine_unknown' | 'engine_start_timeout' | 'agent_gone';
/** A refusal by the runner itself (limits, bad input). Provider problems use ProviderError. */
export class RunnerError extends Error {
  constructor(readonly code: RunnerErrorCode, message: string) { super(message); this.name = 'RunnerError'; }
}
export class RunnerBusy extends RunnerError { constructor(readonly limit: number) { super('runner_busy', `All ${limit} agent slots are in use.`); this.name = 'RunnerBusy'; } }
