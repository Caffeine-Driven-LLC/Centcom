import type { AgentId } from '../events/index.js';
import type { AgentRunner } from '../runner/types.js';
import type { RunnerClock, RunnerLog } from '../runner/types.js';
import type { EngineId } from '../types.js';
import type { Worktree, WorktreeManager } from '../worktrees/manager.js';
import type { AgentBus } from '../events/index.js';
import type { IdGenerator } from '../runner/types.js';

export type FleetState = 'queued' | 'starting' | 'running' | 'waiting' | 'done' | 'failed' | 'canceled';
export type Attention = 'branch ready' | 'needs attention';
export interface FleetNode { id: string; parent?: string; kind: 'agent' | 'subagent'; state: FleetState; label: string; engine?: EngineId; branch?: string; attention?: Attention; /** The agent's own wording for why it failed (an error code). */ error_code?: string }
export interface FleetConfig { max_parallel: number; stagger_ms: number; max_minutes: number; queue_max: number }
export const DEFAULT_FLEET_CONFIG: FleetConfig = { max_parallel: 8, stagger_ms: 1500, max_minutes: 60, queue_max: 32 };
export interface FleetSpawnSpec { repoRoot: string; engine: EngineId; prompt: string; label?: string; ownerSlug: string; baseRef?: string; model?: string; /** The member who owns this agent, for the `agent.spawn` payload. */ ownerId?: string }
export interface BranchReady { agentId: AgentId; branch: string; ahead: number; files: string[] }
export interface FleetResult { outcome: 'ok' | 'error' | 'canceled'; error_code?: string; branchReady: boolean }
export interface FleetHandle {
  readonly id: AgentId; readonly branch: string | undefined; state(): FleetState; done(): Promise<FleetResult>;
  /** Everything the payload builders need; local only. */ describe(): { label: string; engine: EngineId; branch?: string; worktree?: string; model?: string; ownerId?: string };
}
export interface FleetDeps {
  runner: AgentRunner; worktrees: WorktreeManager; entitlements: { maxParallelAgents(): number }; bus: AgentBus; ids: IdGenerator; clock: RunnerClock; log?: RunnerLog; config?: Partial<FleetConfig>;
  /** Of the session this host is in: goes into the `agent.spawn` clear part. `runsOn` is the member whose machine runs the agents. */ session?: { mode: 'command_post' | 'branch'; runsOn?: string };
}
export interface FleetManager {
  spawn(spec: FleetSpawnSpec): Promise<FleetHandle>; list(): FleetNode[]; stop(id: AgentId): Promise<void>; stopAll(): Promise<void>; remove(id: AgentId, o?: { force?: boolean }): Promise<void>;
  mergePreview(id: AgentId): Promise<{ conflicts: string[] }>; onBranchReady(h: (e: BranchReady) => void): () => void; recoverOrphans(repoRoot: string): Promise<Worktree[]>;
  /** Engines whose new spawns are paused after the CLI reported a limit, with the CLI's own message. */ paused(): { engine: EngineId; code: string; message: string }[]; resume(engine: EngineId): void;
  spawnPayload(h: FleetHandle): { clear: { agent_id: string; owner: string; mode: 'command_post' | 'branch'; runs_on?: string; provider: 'anthropic' | 'openai' | 'other' }; secret: { label: string; branch: string; worktree: string; model?: string } };
  exitPayload(h: FleetHandle, r: FleetResult): { clear: { agent_id: string; outcome: 'ok' | 'error' | 'canceled'; error_code?: string }; secret: { detail?: string } };
  dispose(): void;
}
