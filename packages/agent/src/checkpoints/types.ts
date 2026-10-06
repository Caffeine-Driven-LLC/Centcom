import type { AgentEngine, EngineSession } from '../types.js';
import type { GitRunner } from '../worktrees/git.js';
import type { RunnerClock } from '../runner/types.js';

export type RewindMode = 'files' | 'conversation' | 'both';
export interface EngineSessionRef { id: string; /** What the engine says points at a turn, if it says anything. */ turnRef?: string }
export interface Checkpoint { id: string; n: number; at: string; label: string; promptSeq: number; /** The snapshot commit; null when there is no git to snapshot with. */ commit: string | null; engineSession?: EngineSessionRef; files: { changed: number; added: number; removed: number } }
export interface RewindPlan { restore: string[]; delete: string[]; /** Changed by someone other than the agent since the checkpoint: left alone unless confirmed. */ skippedModifiedOutside: string[]; needsConfirm: boolean; conversation: 'engine-resume' | 'fresh-with-summary' | 'none' }
export interface RewindResult { restored: string[]; deleted: string[]; skipped: string[]; /** Paths that could not be put back (the rewind stopped there). */ failed?: { restored: string[]; unrestored: string[] }; undoRef?: string; conversation?: { mode: 'engine-resume' | 'fresh-with-summary'; session: EngineSession; /** The tool's own message when a resume was refused. */ resumeError?: string } }
/** What the checkpoint manager needs from the local transcript store (lane C026). */
export interface CheckpointStore { markRewind(toSeq: number): Promise<void>; /** A plain-text summary of the conversation up to `seq`, at most `maxBytes` bytes. */ summarize(upToSeq: number, maxBytes: number): Promise<string> }
export interface CheckpointFs { copyFile(from: string, to: string): Promise<void>; rm(path: string): Promise<void>; exists(path: string): Promise<boolean>; lstatIsDir(path: string): Promise<boolean | undefined>; rmdirIfEmpty(path: string): Promise<void> }
export interface CheckpointDeps { worktree: string; agentId: string; store: CheckpointStore; engine: Pick<AgentEngine, 'capabilities' | 'start'>; git: GitRunner; clock: RunnerClock; fs?: CheckpointFs }
export interface CheckpointManager {
  /** Loads checkpoints from earlier runs (refs in the repository). Called by every method that needs it. */ ready(): Promise<void>;
  create(label: string, ctx: { promptSeq: number; engineSession?: EngineSessionRef }): Promise<Checkpoint>;
  /** Records the state the agent left at the end of a turn, so edits made by someone else afterwards can be told apart. */ endTurn(): Promise<void>;
  list(): Checkpoint[]; preview(id: string, mode: RewindMode): Promise<RewindPlan>; rewind(id: string, mode: RewindMode, opts?: { confirmedPaths?: string[] }): Promise<RewindResult>;
  /** Removes every ref this agent has under refs/centcom/ (when its session is removed). */ purge(): Promise<void>; dispose(): Promise<void>;
}
