import type { AgentBus, AgentId } from '../events/index.js';
import type { RunnerClock } from '../runner/types.js';
import type { Capability, NormalisedEvent } from '../types.js';

export interface ContextConfig { warn_pct: number; full_pct: number; auto_compact: boolean; auto_pct: number }
export const DEFAULT_CONTEXT_CONFIG: ContextConfig = { warn_pct: 75, full_pct: 97, auto_compact: false, auto_pct: 85 };
export type EngineStatus = 'starting' | 'running' | 'waiting' | 'exited';
export interface ContextEngines { capabilities(id: AgentId): ReadonlySet<Capability>; send(id: AgentId, prompt: string): Promise<void>; status(id: AgentId): EngineStatus; /** The engine's documented compact command (default `/compact`). */ compactPrompt?(id: AgentId): string }
export interface ContextDeps { bus: AgentBus; clock: RunnerClock; config?: Partial<ContextConfig>; engines: ContextEngines; log?: { debug(msg: string, ctx?: Record<string, unknown>): void } }
export interface ContextSnapshot { used?: number; window?: number; pct?: number; /** True when the engine told us the window (or a percentage). */ reported: boolean; totals: { tokens_in: number; tokens_out: number; cost_usd?: number } }
export type CompactionResult = { ok: true } | { ok: false; reason: 'unsupported' | 'busy' | 'not_idle' | 'failed' };
export interface ContextView { onEvent(e: NormalisedEvent): void; snapshot(id: AgentId): ContextSnapshot; requestCompaction(id: AgentId): Promise<CompactionResult>; /** Follow `agent:event` and `agent:exited` on the bus. */ attach(): () => void; dispose(): void }

const HYSTERESIS = 10; const EMIT_MS = 1000; const BACKOFF_MS = 60_000; const MAX_SEEN = 20_000;
interface AgentCtx { in: number; out: number; cost?: number; seen: Set<string>; used?: number; window?: number; pct?: number; warned: boolean; full: boolean; autoAsked: boolean; compacting: boolean; approvals: Set<string>; sending: boolean; backoffUntil: number; lastEmit: number; timer?: unknown; dirty: boolean }
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

/** Shows exactly what the engine reports. Nothing here counts, estimates or summarises anything: a number the engine did not send stays missing. */
export function createContextView(deps: ContextDeps): ContextView {
  const cfg: ContextConfig = { ...DEFAULT_CONTEXT_CONFIG, ...deps.config }; const agents = new Map<string, AgentCtx>(); let unsub: (() => void)[] = [];
  const get = (id: string): AgentCtx => { let a = agents.get(id); if (!a) { a = { in: 0, out: 0, seen: new Set(), warned: false, full: false, autoAsked: false, compacting: false, approvals: new Set(), sending: false, backoffUntil: 0, lastEmit: -Infinity, dirty: false }; agents.set(id, a); } return a; };
  const emitContext = (id: string, a: AgentCtx) => { a.dirty = false; a.lastEmit = deps.clock.now(); deps.bus.emit('agent:context', { agent_id: id as AgentId, ...(a.used !== undefined && { used: a.used }), ...(a.window !== undefined && { window: a.window }), ...(a.pct !== undefined && { pct: a.pct }) }); };
  /** At most one `agent:context` per agent per second; a change inside the window goes out when the window ends. */
  const publish = (id: string, a: AgentCtx) => {
    const wait = a.lastEmit + EMIT_MS - deps.clock.now(); if (wait <= 0) { emitContext(id, a); return; }
    a.dirty = true; if (a.timer === undefined) a.timer = deps.clock.setTimeout(() => { a.timer = undefined; if (a.dirty) emitContext(id, a); }, wait);
  };
  const stopTimer = (a: AgentCtx) => { if (a.timer !== undefined) { deps.clock.clearTimeout(a.timer as never); a.timer = undefined; } a.dirty = false; };

  const thresholds = (id: string, a: AgentCtx) => {
    const pct = a.pct; if (pct === undefined) return; // no engine number, no warning, ever
    if (pct < cfg.warn_pct - HYSTERESIS) a.warned = false; else if (pct >= cfg.warn_pct && !a.warned) { a.warned = true; deps.bus.emit('agent:context_alert', { agent_id: id as AgentId, level: 'warn', pct }); }
    if (a.full && pct < cfg.full_pct - HYSTERESIS) { a.full = false; deps.bus.emit('agent:context_alert', { agent_id: id as AgentId, level: 'ok', pct }); } else if (pct >= cfg.full_pct && !a.full) { a.full = true; deps.bus.emit('agent:context_alert', { agent_id: id as AgentId, level: 'full', pct }); }
    if (pct < cfg.auto_pct - HYSTERESIS) a.autoAsked = false;
  };
  const maybeAuto = (id: string, a: AgentCtx) => {
    if (!cfg.auto_compact || a.autoAsked || a.pct === undefined || a.pct < cfg.auto_pct) return;
    void request(id).then((r) => { if (r.ok) a.autoAsked = true; }, () => undefined); // once per cycle: a refusal because the agent is busy tries again at the next quiet moment
  };
  const setLevel = (a: AgentCtx) => { a.pct = a.used !== undefined && a.window ? Math.min(100, (a.used / a.window) * 100) : a.pct; };

  function onEvent(e: NormalisedEvent): void {
    try {
      const id = e.agent_id; const a = get(id);
      switch (e.type) {
        case 'usage.report': {
          const key = e.message_id ?? `${e.turn_id ?? ''}#${e.seq}`; if (a.seen.has(key)) return; a.seen.add(key); if (a.seen.size > MAX_SEEN) a.seen.delete(a.seen.values().next().value as string);
          a.in += num(e.input_tokens) ?? 0; a.out += num(e.output_tokens) ?? 0; const cost = num(e.cost_usd); if (cost !== undefined) a.cost = (a.cost ?? 0) + cost;
          const used = num(e.context_tokens); const win = num(e.context_window); const pct = num(e.context_used_pct);
          if (win !== undefined && win > 0) a.window = win; if (used !== undefined) a.used = used;
          if (a.used !== undefined && a.window) setLevel(a); else if (pct !== undefined && pct <= 100) a.pct = pct;
          publish(id, a); thresholds(id, a); maybeAuto(id, a); break;
        }
        case 'compaction.started': a.compacting = true; deps.bus.emit('agent:compaction', { agent_id: id as AgentId, phase: 'start' }); break;
        case 'compaction.ended': {
          a.compacting = false; const before = num(e.tokens_before); const after = num(e.tokens_after);
          deps.bus.emit('agent:compaction', { agent_id: id as AgentId, phase: 'end', ...(before !== undefined && { before }), ...(after !== undefined && { after }) });
          if (after !== undefined) { a.used = after; if (a.window) setLevel(a); else a.pct = undefined; publish(id, a); thresholds(id, a); } break;
        }
        case 'approval.requested': a.approvals.add(e.approval_id); break;
        case 'approval.resolved': a.approvals.delete(e.approval_id); break;
        case 'error': if (a.compacting) { a.compacting = false; a.backoffUntil = deps.clock.now() + BACKOFF_MS; } break;
        case 'turn.done': a.approvals.clear(); maybeAuto(id, a); break;
        default: break;
      }
    } catch (err) { deps.log?.debug('context event ignored', { kind: (err as Error)?.name }); } // a malformed event never breaks the stream
  }

  async function request(id: string): Promise<CompactionResult> {
    const aid = id as AgentId; if (!deps.engines.capabilities(aid).has('compact')) return { ok: false, reason: 'unsupported' };
    const st = deps.engines.status(aid); if (st === 'exited') return { ok: false, reason: 'not_idle' };
    const a = get(id); if (st !== 'waiting' || a.approvals.size || a.compacting || a.sending || deps.clock.now() < a.backoffUntil) return { ok: false, reason: 'busy' };
    // the compaction itself is known from the engine's own `compaction.started`; here only a second send is kept out while this one is in flight
    a.sending = true; try { await deps.engines.send(aid, deps.engines.compactPrompt?.(aid) ?? '/compact'); return { ok: true }; }
    catch { a.backoffUntil = deps.clock.now() + BACKOFF_MS; return { ok: false, reason: 'failed' }; }
    finally { a.sending = false; }
  }

  return {
    onEvent, requestCompaction: (id) => request(id),
    snapshot(id) { const a = agents.get(id); if (!a) return { reported: false, totals: { tokens_in: 0, tokens_out: 0 } }; return { ...(a.used !== undefined && { used: a.used }), ...(a.window !== undefined && { window: a.window }), ...(a.pct !== undefined && { pct: a.pct }), reported: a.window !== undefined, totals: { tokens_in: a.in, tokens_out: a.out, ...(a.cost !== undefined && { cost_usd: a.cost }) } }; },
    attach() { const u = [deps.bus.on('agent:event', (p) => onEvent(p.event)), deps.bus.on('agent:exited', (p) => { const a = agents.get(p.agent_id); if (a) { stopTimer(a); a.approvals.clear(); a.compacting = false; } })]; unsub.push(...u); return () => u.forEach((f) => f()); },
    dispose() { for (const f of unsub) f(); unsub = []; for (const a of agents.values()) stopTimer(a); },
  };
}
