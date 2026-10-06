export type CheckpointErrorCode = 'checkpoint_unavailable' | 'operation_in_progress' | 'not_found' | 'git_failed' | 'invalid_path' | 'busy';
/** Refusals of the checkpoint manager. They carry codes, never file contents. */
export class CheckpointError extends Error { constructor(readonly code: CheckpointErrorCode, message: string) { super(message); this.name = 'CheckpointError'; } }
