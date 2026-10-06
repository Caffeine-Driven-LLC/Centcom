import type { EngineId } from '../types.js';

/** What the engines reported, as the ledger takes it. Tokens and cost can each be a running total (`*Cumulative`) or a per-turn amount. */
export interface UsageReport { agentId: string; engine: EngineId; engineSessionId: string; sessionId?: string; cumulative: boolean; costCumulative?: boolean; tokensIn?: number; tokensOut?: number; cacheRead?: number; cacheWrite?: number; costUsd?: number; model?: string; perModel?: Record<string, { tokensIn: number; tokensOut: number; costUsd?: number }> }
export interface LedgerTotals { tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number; agentMs: number; costUsdReported: number | null; costLabel: 'estimate' | 'not-reported'; limitEvents: number; dropped: number }
export interface DayTotals extends LedgerTotals { day: string }
/** Informational only (CT-API-USAGE): never enforced or billed from here. No text, paths, branches, models or engine ids. */
export interface UsageEvent { id: string; type: 'agent_minutes' | 'tokens_in' | 'tokens_out'; qty: number; at: string; session_id?: string; agent_id?: string }
export interface Ledger {
  snapshot(scope?: { agentId?: string; sessionId?: string; day?: string }): LedgerTotals; byDay(days: number): DayTotals[];
  onUsageReport(r: UsageReport): void; onAgentState(agentId: string, state: string, at: Date): void; onLimitEvent(agentId: string): void;
  dequeueBatch(max?: number): UsageEvent[]; ack(ids: string[]): Promise<void>; requeue(ids: string[]): void; flush(): Promise<void>; pending(): number;
}
