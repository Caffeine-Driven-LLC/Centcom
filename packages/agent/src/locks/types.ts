import type { PConflictDetected, PFileLock } from '@centcom/protocol';
import type { AgentBus, AgentId } from '../events/index.js';
import type { RunnerClock } from '../runner/types.js';

export type FileLockPayload = PFileLock;
export type LockMode = 'warn' | 'block';
export interface LockFs {
  realpath(p: string): Promise<string>;
  /** Creates the file with this content only if it does not exist (atomically, content complete when visible). False if it exists. */ createExclusive(path: string, text: string): Promise<boolean>;
  read(path: string): Promise<string | undefined>; /** Atomic replace of a file we own. */ replace(path: string, text: string): Promise<void>; remove(path: string): Promise<void>; mkdirp(dir: string): Promise<void>;
  pidAlive(pid: number): boolean;
}
export interface LockTransport { publish(p: { clear: FileLockPayload; secret: { path: string } }): void; /** False while the connection is down: events are queued. */ ready?(): boolean }
export interface LockDeps {
  root: string; fs: LockFs; clock: RunnerClock; bus: AgentBus; pathMac?: (relPath: string) => string; transport?: LockTransport; config: { mode: LockMode; defaultTtlMs: number }; pid?: number;
  /** `win32` and `darwin` compare file names without regard to case. */ caseInsensitive?: boolean; platform?: 'posix' | 'win32';
  /** False once an agent has stopped: its locks are then no longer renewed. */ agentRunning?(agentId: AgentId): boolean;
  /** From the session roster: events from agents that are not members are ignored. */ isMember?(agentId: string): boolean;
  /** Called once per new conflict with the `conflict.detected` clear payload. */ onConflictDetected?(p: PConflictDetected): void;
  log?: { debug(m: string, c?: Record<string, unknown>): void; warn(m: string, c?: Record<string, unknown>): void }; waitMs?: number;
}
export type LockResult = { ok: true; heldBy?: AgentId } | { ok: false; reason: 'held'; heldBy: AgentId; expiresAt: string } | { ok: false; reason: 'timeout' };
export interface LockInfo { heldBy: AgentId; expiresAt: string; remote: boolean }
export interface LockConflict { agentIds: [AgentId, AgentId]; path_hmac: string }
export interface LockClient {
  acquire(path: string, o: { agentId: AgentId; ttlMs?: number }): Promise<LockResult>; release(path: string, agentId: AgentId): Promise<void>; releaseAll(agentId: AgentId): Promise<void>;
  check(path: string): LockInfo | null; onRemoteLock(evt: FileLockPayload): void; conflicts(): LockConflict[]; /** Sends what was queued while the transport was down. */ flush(): void; conflictPayload(c: LockConflict): PConflictDetected; dispose(): void;
}
export type { AgentBus };
