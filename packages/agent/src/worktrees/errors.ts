export type WorktreeErrorCode = 'not_a_git_repo' | 'dirty_worktree' | 'branch_exists' | 'git_timeout' | 'git_too_old' | 'unsafe_root' | 'unknown_worktree' | 'duplicate_agent' | 'bad_ref' | 'git_failed';
/** A refusal or failure of the worktree manager. Messages are calm and never contain paths or branch names (those are secret on the wire). */
export class WorktreeError extends Error { constructor(readonly code: WorktreeErrorCode, message: string, readonly reason?: 'uncommitted' | 'unmerged') { super(message); this.name = 'WorktreeError'; } }
const mk = (code: WorktreeErrorCode, message: string) => class extends WorktreeError { constructor(reason?: 'uncommitted' | 'unmerged') { super(code, message, reason); } };
export class NotAGitRepo extends mk('not_a_git_repo', 'This folder is not a normal git repository, so branch mode is not available here.') { override name = 'NotAGitRepo'; }
export class DirtyWorktree extends mk('dirty_worktree', 'The worktree has uncommitted changes or commits that are not merged.') { override name = 'DirtyWorktree'; }
export class BranchExists extends mk('branch_exists', 'Could not find a free branch name.') { override name = 'BranchExists'; }
export class GitTimeout extends mk('git_timeout', 'Git did not answer in time.') { override name = 'GitTimeout'; }
export class GitTooOld extends mk('git_too_old', 'Branch mode needs git 2.38 or newer.') { override name = 'GitTooOld'; }
