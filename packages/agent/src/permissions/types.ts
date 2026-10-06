import type { ApprovalDecision, ApprovalRequest, EngineId, Risk } from '../types.js';
export type { ApprovalDecision, ApprovalRequest };

/** Centcom's own modes. (The engines have their own CLI-level `PermissionMode`; C016 maps one to the other.) */
export type PolicyMode = 'ask' | 'accept-edits' | 'plan' | 'auto-low-risk' | 'bypass';
export type RuleAction = 'allow' | 'deny' | 'ask';
export type RuleScope = 'session' | 'project' | 'user';
export interface Rule { id: string; engine?: EngineId | '*'; tool: string; matcher?: { command?: string; path_glob?: string; mcp_server?: string }; action: RuleAction; scope: RuleScope; created_at: string }
export interface Decision { action: RuleAction; reason: string; rule?: string; /** A hard deny: no rule, mode or engine answer can change it. */ hard?: boolean }
export interface AgentCtx { agentId: string; /** The agent's worktree (or folder): the only place it may write. */ root: string; mode: PolicyMode; engine?: EngineId; stopped?: boolean; /** Member who owns the agent (for the `owner` approver policy). */ owner?: string }
export type Approver = 'host' | 'owner' | 'any_editor';
export interface PendingApproval { approval_id: string; agent_id: string; tool: string; summary: string; command?: string; cwd?: string; path?: string; risk: Risk; expires_at: string; approver: Approver; engine?: EngineId }
export interface MemberRef { id: string; role: 'host' | 'editor' | 'viewer' | 'unknown'; /** Delegated approver under the workspace's policy (CT-RBAC). */ delegated?: boolean }
export interface ApprovalPrompter { prompt(p: PendingApproval, signal: AbortSignal): Promise<ApprovalDecision> }
export interface RiskClassifier { classify(req: ApprovalRequest): Risk }
export type AuditEvent = { type: 'decided' | 'expired' | 'cancelled' | 'remote_rejected' | 'remote_accepted' | 'hard_deny' | 'rules_warning'; approval_id?: string; agent_id?: string; by?: string; reason?: string; decision?: 'approve' | 'deny' };
export interface PermConfig { os?: 'posix' | 'win32'; home: string; /** `<config dir>/permissions.json` */ userRulesPath: string; approvalTimeoutMs?: number; /** `permissions.bypass` opt-in: without it `bypass` behaves like `ask`. */ bypassEnabled?: boolean; /** No prompter possible (print mode): anything that would ask is denied. */ headless?: boolean; defaultApprover?: Approver }
