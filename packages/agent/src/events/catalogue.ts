/** The internal events of the agent runtime. Names are `domain:verb`, on purpose unlike wire kinds, and are not part of any contract.
 *  Fields marked `wire-safe` hold only ids, enums, numbers and timestamps; everything else may hold local text or paths and must never be forwarded as is. */
import type { Id, StateName } from '@centcom/protocol';
import type { NormalisedEvent, Risk } from '../types.js';

export type AgentId = Id<'agt'>;
export type ApprovalId = Id<'apr'>;
export type MemberId = Id<'mem'>;
export type Iso = string;

export type AgentEventMap = {
  'agent:started': { agent_id: AgentId /* wire-safe */; engine: string /* wire-safe */; model?: string /* wire-safe */; cwd: string; at: Iso /* wire-safe */ };
  'agent:prompt': { agent_id: AgentId; text: string; at: Iso };
  'agent:message_delta': { agent_id: AgentId; message_id: string; text: string };
  'agent:message_done': { agent_id: AgentId; message_id: string; text: string; at: Iso };
  'agent:tool_requested': { agent_id: AgentId; tool_id: string; name: string; summary: string; risk: Risk; path?: string; command?: string };
  'agent:tool_result': { agent_id: AgentId; tool_id: string; ok: boolean; summary?: string };
  /** wire-safe: ids and enums only */
  'agent:approval_needed': { agent_id: AgentId; approval_id: ApprovalId; risk: Risk; expires_at: Iso };
  /** wire-safe */
  'agent:approval_resolved': { agent_id: AgentId; approval_id: ApprovalId; decision: 'allow' | 'deny' | 'timeout' | 'cancel'; by?: MemberId };
  /** wire-safe */
  'agent:state_changed': { agent_id: AgentId; state: StateName; since: Iso };
  'agent:context': { agent_id: AgentId; used_tokens: number; window_tokens: number };
  'agent:compaction': { agent_id: AgentId; before_tokens: number; after_tokens: number };
  /** Every normalised event of one agent, stamped by the runner with a gap-free per-agent `seq`. */
  'agent:event': { agent_id: AgentId; seq: number; event: NormalisedEvent };
  /** wire-safe: the outcome and, for a crash, the exit code or signal name. `reason` is a local error code, never text from the model. */
  'agent:exited': { agent_id: AgentId; outcome: 'ok' | 'error' | 'canceled' | 'crash'; code?: number; signal?: string; reason?: string };
  'worktree:created': { agent_id: AgentId; path: string; branch: string };
  'worktree:removed': { agent_id: AgentId; path: string };
  'lock:changed': { agent_id: AgentId; path: string; action: 'acquire' | 'release' | 'expire'; ttl_ms?: number };
  'lock:conflict': { agent_id: AgentId; other_agent_id: AgentId; path: string };
  /** The MCP servers one tool reports, as the manager understands them. */
  'mcp:status': { engine: 'claude-code' | 'codex'; servers: { name: string; state: string; tools?: number; error?: string; builtin?: boolean }[] };
  'subagent:spawned': { agent_id: AgentId; parent_id: AgentId; role?: string };
  'subagent:finished': { agent_id: AgentId; parent_id: AgentId; ok: boolean };
};

export type AgentEventName = keyof AgentEventMap;
/** Events whose whole payload may be turned into a wire frame (CT-WS-SESSION-EVENTS). */
export const WIRE_SAFE_EVENTS = ['agent:approval_needed', 'agent:approval_resolved', 'agent:state_changed'] as const satisfies readonly AgentEventName[];
