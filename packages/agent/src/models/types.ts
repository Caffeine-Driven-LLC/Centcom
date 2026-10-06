import type { Capability, EngineId } from '../types.js';

export interface ReportedModel { id: string; label?: string; reportedBy: 'init-event' | 'model-command' | 'alias'; engineVersion?: string }
export interface ModelSelection { engine: EngineId; model: string | null; passAs: 'flag' | 'command' | 'protocol' }
export interface Current { engine: EngineId; model: string | null; source: 'engine-reported' | 'flag' | 'override' | 'config' }
export interface ModelRegistry {
  /** What the engine reported plus the user's aliases (cached). */
  list(engine: EngineId): Promise<ReportedModel[]>;
  current(agentId: string): Current;
  /** Which model an agent starts with: flag, session override, project config, user config, else nothing (the engine's own default). */
  resolve(agentId: string, input?: string): ModelSelection;
  /** A switch applies at the next turn boundary; returns at once while a turn streams. */
  switchTo(agentId: string, name: string, reason: 'user' | 'config'): Promise<ModelSelection & { note?: string }>;
  /** The engine refused the model: the previous one stays. */
  onRejected(agentId: string, text: string): void;
  /** Feed every agent's normalised events here (session.started, turn.started, turn.done, error). */
  onEvent(agentId: string, ev: { type: string; [k: string]: unknown }): void;
  /** Registers an agent so it can be switched. */
  attach(a: { agentId: string; engine: EngineId; setModel(m: string): void; flag?: string }): void;
  /** `/model` with no argument: one line per model, at most 80 columns, the current one marked `*`. */
  describe(agentId: string): Promise<string[]>;
}
export interface ModelConfig { model?: string; projectModel?: string; aliases?: Record<string, string> | string[]; cacheTtlHours?: number }
export interface ModelFs { read(p: string): Promise<string | undefined>; write(p: string, text: string): Promise<void> }
export interface ModelDeps {
  config: () => ModelConfig;
  bus: { emit(k: 'model.changed', p: { agent_id: string; from: string | null; to: string; reason: 'user' | 'config' }): void };
  engines: { get(id: string): { id: EngineId; capabilities(): ReadonlySet<Capability>; listModels?(): Promise<{ id: string; label?: string }[]>; version?(): string | undefined } | undefined };
  cachePath: string; fs: ModelFs; clock: { now(): number };
  log?: { debug(m: string, f?: Record<string, unknown>): void };
  /** Notices for the person (toasts). */ notify?: (level: 'info' | 'warn', text: string, detail?: string) => void;
}
