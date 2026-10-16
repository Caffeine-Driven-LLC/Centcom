/** The engine interface and the normalised event stream (lane C101). Provider details stay behind AgentEngine. */
export type EngineId = 'claude-code' | 'codex' | 'fake';
export type ProviderId = 'anthropic' | 'openai' | 'other';
export type Capability = 'streaming' | 'approvals' | 'resume' | 'subagents' | 'mcp' | 'skills' | 'thinking' | 'usage' | 'models.list' | 'interrupt' | 'compact';
export type LoginKind = 'subscription' | 'api_key' | 'cloud' | 'unknown';
export type Risk = 'low' | 'medium' | 'high';
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

export type ProviderErrorCode =
  | 'provider_not_installed' | 'provider_not_signed_in' | 'provider_method_disabled' | 'provider_policy_blocked'
  | 'provider_cap_reached' | 'provider_rate_limited' | 'provider_version_unsupported' | 'provider_protocol_error' | 'provider_capability_missing';

export class ProviderError extends Error {
  constructor(public code: ProviderErrorCode, public engine: EngineId, message: string, public tool_message?: string) { super(message); this.name = 'ProviderError'; }
}

interface Base { v: 1; seq: number; ts: string; agent_id: string; turn_id?: string }
export type EventBody =
  | { type: 'session.started'; engine: EngineId; engine_session_id: string; model: string; cli_version?: string; tools: string[]; mcp_servers: { name: string; status: string }[]; capabilities: Capability[]; login_kind: LoginKind; /** The skills the engine itself loaded for this session, when it says (Claude Code does in its start message). */ skills?: string[] }
  | { type: 'turn.started'; turn_id: string }
  | { type: 'text.delta'; message_id: string; index: number; text: string }
  | { type: 'text.done'; message_id: string; text?: string; input_tokens?: number; output_tokens?: number }
  | { type: 'thinking.delta'; message_id: string; text: string }
  | { type: 'tool.requested'; tool_id: string; name: string; input_summary: string; risk: Risk; parent_tool_id?: string; path?: string; command?: string }
  | { type: 'approval.requested'; approval_id: string; tool_id: string; summary: string; command?: string; cwd?: string; risk: Risk; diff?: string; path?: string }
  | { type: 'approval.resolved'; approval_id: string; decision: 'approve' | 'deny'; scope: 'once' | 'session' | 'always'; by: 'user' | 'policy' | 'timeout' | 'interrupt' }
  | { type: 'tool.result'; tool_id: string; status: 'ok' | 'error' | 'denied' | 'canceled'; summary: string; diff?: string }
  | { type: 'subagent.started'; subagent_id: string; parent_tool_id: string; label: string }
  | { type: 'subagent.text'; subagent_id: string; text: string }
  | { type: 'subagent.done'; subagent_id: string; status: 'ok' | 'error' | 'canceled' }
  | { type: 'usage.report'; /** The engine's id of the message this usage belongs to; used to keep a replay from counting twice. */ message_id?: string; input_tokens: number; output_tokens: number; cache_read_tokens?: number; cost_usd?: number; cost_is_estimate: true; context_used_pct?: number; context_tokens?: number; context_window?: number }
  /** One request to the model finished (the main conversation or a sub-agent): what the live meter and the budget guard count while a turn is still running. `usage.report` follows at the end of the turn with the totals and the cost. */
  | { type: 'usage.progress'; message_id: string; scope: 'main' | 'subagent'; input_tokens: number; output_tokens: number; cache_read_tokens?: number }
  | { type: 'limits.report'; windows: { name: string; utilization: number; resets_at: number }[] }
  | { type: 'model.changed'; model: string; reason: 'user' | 'fallback' | 'engine' }
  | { type: 'status'; state: string; detail?: string }
  /** The agent's own plan (Claude Code's TodoWrite, Codex's plan updates): the whole list each time. */
  | { type: 'tasks.updated'; tasks: { id: string; text: string; status: 'pending' | 'in_progress' | 'completed' }[] }
  | { type: 'compaction.started' } | { type: 'compaction.ended'; tokens_before?: number; tokens_after?: number }
  | { type: 'question.asked'; question_id: string; text: string; options?: string[]; /** The agent allows ticking several options. */ multi?: boolean; /** The engine asks the person itself through its question gate and takes the answer directly: the app must not open a second list for this event. */ direct?: boolean }
  | { type: 'engine.warning'; code: string; text: string }
  | { type: 'error'; code: ProviderErrorCode; tool_message: string; fatal: boolean; retry?: { attempt: number; max_retries: number; delay_ms: number } }
  | { type: 'turn.done'; outcome: 'ok' | 'error' | 'canceled'; stop_reason?: string };
export type NormalisedEvent = EventBody & Base;
export type EventType = NormalisedEvent['type'];

export interface ApprovalRequest {
  approval_id: string; agent_id: string; tool_id: string; tool: string; summary: string;
  command?: string; cwd?: string; path?: string; risk: Risk; diff?: string;
}
export interface ApprovalDecision { decision: 'approve' | 'deny'; scope: 'once' | 'session' | 'always'; reason?: string }
/** Injected into engines; the permission policy engine (C015) / the UI answers. */
/** One question an engine asks the person: choose among `options`, or type text when there are none. */
export interface EngineQuestion { id: string; header?: string; text: string; options?: { label: string; description?: string }[]; /** The person may type something else. */ allowOther?: boolean; /** The answer is a secret (do not echo or log it). */ secret?: boolean }
/** Answers per question id; undefined when the person cancelled. */
export interface QuestionGate { ask(questions: EngineQuestion[]): Promise<Record<string, string[]> | undefined> }
export interface PermissionGate { decide(req: ApprovalRequest): Promise<ApprovalDecision> }

export interface EngineStartOptions {
  agentId: string;
  cwd: string;
  permissionMode?: PermissionMode;
  model?: string;
  resume?: { engine_session_id: string };
  systemPromptAppend?: string;
  /** Background the engine should have once (a summary of an earlier conversation). Claude Code gets it in front of the first message of a fresh session and never again, so the system prompt stays short and identical on every turn; Codex gets it as its developer instructions. */
  carryOver?: string;
  /** Reasoning effort to start with (Claude Code `--effort`); `setEffort` changes it later. */
  effort?: string;
  /** The model sub-agents run on (Claude Code: CLAUDE_CODE_SUBAGENT_MODEL). Unset leaves it to the engine, and the person's own variable always wins. */
  subagentModel?: string;
  /** Asked before each sub-agent starts (Claude Code, through a hook on its sub-agent tool); a no refuses that one with the reason. Needs `approvalGate`. */
  subagentGate?: () => { allow: boolean; reason?: string };
  /** Extra directories the agent may read (e.g. the bundled skills). */
  addDirs?: string[];
  allowedTools?: string[];
  env?: Record<string, string | undefined>;
  /** When true `env` is the child's whole environment (the runner's allow-list); otherwise it is added on top of process.env. */
  envExact?: boolean;
  approvalGate?: PermissionGate;
  /** Where an engine's questions to the person go when it can take the answer directly (Codex). Without one the question is declined. */
  questionGate?: QuestionGate;
  limits?: { spawn_timeout_ms?: number; first_event_timeout_ms?: number; models_timeout_ms?: number; interrupt_grace_ms?: number };
  /** A session that starts in `bypassPermissions` must say it may (the person chose it, or `--dangerously-skip-permissions`); without this the engine starts in ask mode and says so. A later `setPermissionMode` is the person's own call and is honoured. */
  allowBypass?: boolean;
  /** Run a CLI whose version is outside the range Centcom has been checked against (config `agent.engine_unsupported_ok`). */
  unsupportedOk?: boolean;
}

export interface EngineSession {
  readonly agentId: string;
  readonly events: AsyncIterable<NormalisedEvent>;
  send(prompt: string): Promise<{ turn_id: string }>;
  /** Ends the current turn. `hard` skips the grace time. Engines may say how (`method`) and which processes they signalled. */
  interrupt(o?: { hard?: boolean }): Promise<{ stopped: boolean; method?: 'protocol' | 'sigint'; /** The engine confirmed the interrupt itself (Claude Code's `interrupt_receipt_v1`) before the turn ended. */ receipt?: boolean; terminated?: { pid: number; signal: 'SIGINT' | 'SIGTERM' | 'SIGKILL' }[] }>;
  /** The card also allows reporting how the engine ended; engines that return nothing remain valid. */
  stop(): Promise<void | { exit_code: number | null; signal: string | null }>;
  resumeToken(): string | undefined;
  setModel?(model: string): void;
  /** Reasoning effort for the next turns (Codex: low … max). Empty clears it. */
  setEffort?(effort: string): void;
  /** Limits for the next turn: no sub-agent tool at all, and the engine's own cap on what the turn may cost. Replaces the ones before. */
  setTurnLimits?(l: { noSubagents?: boolean; maxBudgetUsd?: number }): void;
  /** Asks the engine to compact the conversation now (Codex: thread/compact/start). */
  compact?(): Promise<void>;
  setPermissionMode?(mode: PermissionMode): void;
  /** Sends a signal to the engine's process, if it has one right now. Used by the runner to escalate an ignored interrupt. */
  signal?(sig: 'SIGINT' | 'SIGTERM' | 'SIGKILL'): void;
  /** Resolves when a long-lived engine process dies on its own (not when stop() was called). Per-turn engines leave this unset: a dead turn process just fails that turn. */
  readonly exited?: Promise<{ code?: number; signal?: string }>;
}

export interface AgentEngine {
  readonly id: EngineId;
  readonly provider: ProviderId;
  readonly label: string;
  capabilities(): ReadonlySet<Capability>;
  start(o: EngineStartOptions): Promise<EngineSession>;
  /** Models the engine reports through its own documented commands; only with capability `models.list`. */
  listModels?(): Promise<{ id: string; label?: string }[]>;
  /** The engine CLI's version, when known (a changed version invalidates cached model lists). */
  version?(): string | undefined;
}
