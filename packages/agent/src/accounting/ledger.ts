/** Usage as the engines reported it, per agent, session and day. Costs are shown only when an engine gave one, always as an estimate; nothing here has a price table or enforces any limit. */
import type { AgentBus } from '../events/index.js';
import type { RunnerClock } from '../runner/types.js';
import { Outbox, type OutboxFs } from './outbox.js';
import type { DayTotals, Ledger, LedgerTotals, UsageEvent, UsageReport } from './types.js';

/** States that do not count as working time. */
export const IDLE_STATES = new Set(['idle', 'ready', 'sleeping', 'away', 'awaiting-approval', 'asking-question']);
const AGENT_ID = /^agt_[0-9A-HJKMNP-TV-Z]{26}$/; const SESSION_ID = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/;
interface Acc { tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number; agentMs: number; cost: number | null; limitEvents: number }
const zero = (): Acc => ({ tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, agentMs: 0, cost: null, limitEvents: 0 });
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
export interface LedgerDeps { clock: RunnerClock; ids: { next(prefix: 'use'): string }; bus?: AgentBus; fs: OutboxFs; outboxPath: string; config?: { sessionUsd?: number } }

export function createLedger(d: LedgerDeps): Ledger & { ready(): Promise<void> } {
  const outbox = new Outbox(d.fs, d.outboxPath); const agents = new Map<string, Acc>(); const sessions = new Map<string, Acc>(); const days = new Map<string, Acc>(); const total = zero();
  const lastCum = new Map<string, { tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number }>(); const lastCost = new Map<string, number>();
  const active = new Map<string, { since?: number; carryMs: number; sessionId?: string }>(); const alerted = new Map<string, Set<'warn' | 'error'>>(); const sessionOf = new Map<string, string>();
  const dayKey = (t: number) => { const x = new Date(t); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const buckets = (agentId: string, sessionId?: string) => { const out = [total, get(agents, agentId), get(days, dayKey(d.clock.now()))]; if (sessionId) out.push(get(sessions, sessionId)); return out; };
  function get(m: Map<string, Acc>, k: string) { let a = m.get(k); if (!a) { a = zero(); m.set(k, a); } return a; }
  const at = () => new Date(d.clock.now()).toISOString();
  const event = (type: UsageEvent['type'], qty: number, agentId: string, sessionId?: string) => { if (qty <= 0) return; outbox.push({ id: d.ids.next('use'), type, qty, at: at(), ...(sessionId && SESSION_ID.test(sessionId) ? { session_id: sessionId } : {}), ...(AGENT_ID.test(agentId) ? { agent_id: agentId } : {}) }); };
  const totals = (a: Acc): LedgerTotals => ({ tokensIn: a.tokensIn, tokensOut: a.tokensOut, cacheRead: a.cacheRead, cacheWrite: a.cacheWrite, agentMs: a.agentMs, costUsdReported: a.cost, costLabel: a.cost === null ? 'not-reported' : 'estimate', limitEvents: a.limitEvents, dropped: outbox.dropped });

  function budget(sessionId: string | undefined) {
    const limit = d.config?.sessionUsd; if (!sessionId || !limit || limit <= 0) return; const cost = sessions.get(sessionId)?.cost; if (cost === null || cost === undefined) return; // no reported cost, no alert
    const pct = cost / limit; const done = alerted.get(sessionId) ?? new Set(); alerted.set(sessionId, done);
    for (const [level, at_] of [['warn', 0.8], ['error', 1]] as const) if (pct >= at_ && !done.has(level)) { done.add(level); d.bus?.emit('cost.alert', { level, pct: Math.round(pct * 100), session_id: sessionId }); }
  }
  const ledger: Ledger & { ready(): Promise<void> } = {
    ready: () => outbox.load(),
    onUsageReport(r) {
      const key = `${r.engine}:${r.engineSessionId}`; const cur = { tokensIn: int(r.tokensIn), tokensOut: int(r.tokensOut), cacheRead: int(r.cacheRead), cacheWrite: int(r.cacheWrite) }; let delta = cur;
      if (r.cumulative) { const prev = lastCum.get(key); lastCum.set(key, cur); if (prev && cur.tokensIn >= prev.tokensIn && cur.tokensOut >= prev.tokensOut) delta = { tokensIn: cur.tokensIn - prev.tokensIn, tokensOut: cur.tokensOut - prev.tokensOut, cacheRead: Math.max(0, cur.cacheRead - prev.cacheRead), cacheWrite: Math.max(0, cur.cacheWrite - prev.cacheWrite) }; } // a total that went down is a new baseline: all of it counts
      let costDelta: number | undefined; if (typeof r.costUsd === 'number' && Number.isFinite(r.costUsd) && r.costUsd >= 0) { if (r.costCumulative ?? r.cumulative) { const prev = lastCost.get(key); lastCost.set(key, r.costUsd); costDelta = prev !== undefined && r.costUsd >= prev ? r.costUsd - prev : r.costUsd; } else costDelta = r.costUsd; }
      const sid = r.sessionId ?? sessionOf.get(r.agentId); if (r.sessionId) sessionOf.set(r.agentId, r.sessionId);
      for (const b of buckets(r.agentId, sid)) { b.tokensIn += delta.tokensIn; b.tokensOut += delta.tokensOut; b.cacheRead += delta.cacheRead; b.cacheWrite += delta.cacheWrite; if (costDelta !== undefined) b.cost = (b.cost ?? 0) + costDelta; }
      event('tokens_in', delta.tokensIn, r.agentId, sid); event('tokens_out', delta.tokensOut, r.agentId, sid); budget(sid);
    },
    onAgentState(agentId, state, when) {
      const t = when.getTime(); const a = active.get(agentId) ?? { carryMs: 0 }; active.set(agentId, a); const working = !IDLE_STATES.has(state);
      if (a.since !== undefined) { const ms = Math.max(0, t - a.since); for (const b of buckets(agentId, sessionOf.get(agentId))) b.agentMs += ms; a.carryMs += ms; const whole = Math.floor(a.carryMs / 60_000); if (whole > 0) { a.carryMs -= whole * 60_000; event('agent_minutes', whole, agentId, sessionOf.get(agentId)); } }
      a.since = working ? t : undefined;
    },
    onLimitEvent(agentId) { for (const b of buckets(agentId, sessionOf.get(agentId))) b.limitEvents++; },
    snapshot(scope = {}) { const a = scope.agentId ? agents.get(scope.agentId) : scope.sessionId ? sessions.get(scope.sessionId) : scope.day ? days.get(scope.day) : total; return totals(a ?? zero()); },
    byDay(n) { const out: DayTotals[] = []; const now = d.clock.now(); for (let i = 0; i < n; i++) { const k = dayKey(now - i * 86_400_000); out.push({ day: k, ...totals(days.get(k) ?? zero()) }); } return out; },
    dequeueBatch: (max) => outbox.dequeue(max), ack: async (ids) => { outbox.ack(ids); await outbox.save(); }, requeue: (ids) => outbox.requeue(ids), flush: () => outbox.save(), pending: () => outbox.size(),
  };
  return ledger;
}
