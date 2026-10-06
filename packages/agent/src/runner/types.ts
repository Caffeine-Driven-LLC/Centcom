import type { newIdGenerator } from '@centcom/protocol';
import type { AgentEngine, EngineId, NormalisedEvent, PermissionGate, PermissionMode } from '../types.js';
import type { AgentBus, AgentId } from '../events/index.js';

export type AgentStatus = 'starting' | 'running' | 'waiting' | 'stopping' | 'exited' | 'crashed';
export type IdGenerator = ReturnType<typeof newIdGenerator>;

/** The only time source the runner uses, so tests can move it by hand. `@centcom/testkit`'s VirtualClock fits. */
export interface RunnerClock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: never): void }
/** Same shape as `@centcom/net`'s Logger (the part the runner uses). Only ids, kinds, durations and counts are ever logged. */
export interface RunnerLog { debug(msg: string, ctx?: Record<string, unknown>): void; info(msg: string, ctx?: Record<string, unknown>): void; warn(msg: string, ctx?: Record<string, unknown>): void; error(msg: string, ctx?: Record<string, unknown>): void }

export interface EngineRegistry {
  get(id: EngineId): AgentEngine | undefined;
  /** Throws a ProviderError (`provider_not_installed`, `provider_version_unsupported`) when the engine cannot run. Called before anything is spawned. */
  preflight?(id: EngineId): Promise<void>;
}

export interface RunnerConfig {
  /** `agent.max_parallel`: default 4, hard cap 16. */
  maxParallel: number;
  promptQueueMax: number; startTimeoutMs: number; turnWatchdogMs: number; ringSize: number;
  /** Time an engine gets to honour an interrupt before SIGTERM, then before SIGKILL. */
  interruptGraceMs: number; termGraceMs: number;
  restartDelaysMs: readonly number[];
  approvalTimeoutMs: number;
}
export const DEFAULT_RUNNER_CONFIG: RunnerConfig = { maxParallel: 4, promptQueueMax: 20, startTimeoutMs: 30_000, turnWatchdogMs: 30 * 60_000, ringSize: 1000, interruptGraceMs: 5000, termGraceMs: 2000, restartDelaysMs: [1000, 4000], approvalTimeoutMs: 10 * 60_000 };
export const MAX_PARALLEL_HARD_CAP = 16;

export type TrustKind = 'mcp' | 'hooks' | 'project-rules';
export interface TrustStore {
  isTrusted(kind: TrustKind, sha256: string): Promise<boolean>;
  trust(kind: TrustKind, sha256: string, label: string): Promise<void>;
  revoke(kind: TrustKind, sha256: string): Promise<void>;
}

export interface AgentSpec {
  engine: EngineId; cwd: string; prompt: string; model?: string; permissionMode?: PermissionMode; resume?: string;
  restart?: 'never' | 'on-crash'; parentAgentId?: AgentId; allowSharedCwd?: boolean;
  /** Finish with `agent:exited{outcome}` after the first turn (print mode). */
  oneShot?: boolean;
  systemPromptAppend?: string; addDirs?: string[]; allowedTools?: string[];
}

export interface AgentEvent { agent_id: AgentId; seq: number; event: NormalisedEvent }
export type ExitOutcome = 'ok' | 'error' | 'canceled' | 'crash';
export interface AgentInfo { id: AgentId; engine: EngineId; status: AgentStatus; since: string; parent?: AgentId; turns: number; queued: number; outcome?: ExitOutcome }

export interface AgentHandle {
  readonly id: AgentId; readonly engine: EngineId;
  send(prompt: string): Promise<void>;
  /** Ends the current turn; an engine that ignores it is sent SIGTERM at 5 s and SIGKILL at 7 s and the agent ends as `canceled`. */
  interrupt(): Promise<void>;
  stop(): Promise<void>;
  /** Replays the last events still in the ring (when `replay` is true), then follows live. */
  events(o?: { replay?: boolean }): AsyncIterable<AgentEvent>;
  status(): AgentStatus;
}

export interface AgentRunner {
  start(spec: AgentSpec): Promise<AgentHandle>;
  get(id: AgentId): AgentHandle | undefined;
  list(): AgentInfo[];
  /** Stops every live agent in parallel. With `graceMs`, agents still running when it passes are SIGKILLed and ended as canceled. */
  stopAll(o?: { graceMs?: number }): Promise<void>;
  /** Answers an approval the engine is waiting on (used by the UI and the IPC `approve` command). */
  resolveApproval(agentId: AgentId, approvalId: string, d: { decision: 'approve' | 'deny'; scope?: 'once' | 'session' | 'always' }): boolean;
}

export interface RunnerDeps {
  engines: EngineRegistry; bus: AgentBus; ids: IdGenerator; clock: RunnerClock; log: RunnerLog; config?: Partial<RunnerConfig>; trust?: TrustStore;
  /** Defaults to the runner's own pending-approval gate; C015 supplies the real policy broker. */
  permissions?: PermissionGate & {
    /** Optional. Called with an approval id when the agent that asked ends, crashes, is stopped or has its turn cut short before an answer arrived, so the broker can drop the pending prompt and settle its `decide()` promise (as a deny). The runner tracks the ids from `approval.requested` / `approval.resolved` events and from `decide()` calls. */
    cancel?(approval_id: string): void;
  };
  /** The `provider.*` kill switch (C105). Return false to refuse an engine. */
  providerEnabled?: (engine: EngineId) => boolean;
  /** The parent environment the child env is built from. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
}
