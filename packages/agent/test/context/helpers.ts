import { VirtualClock } from '@centcom/testkit';
import { createAgentBus, createContextView, type AgentId, type Capability, type ContextConfig, type EngineStatus, type EventBody, type NormalisedEvent } from '../../src/index.js';

export const AGT = 'agt_01JTEST0000000000000000001' as AgentId;
export const ev = (b: EventBody, seq: number): NormalisedEvent => ({ ...b, v: 1, seq, ts: '2026-10-06T00:00:00.000Z', agent_id: AGT } as NormalisedEvent);
export function rig(o: { caps?: Capability[]; status?: EngineStatus; config?: Partial<ContextConfig>; sendFails?: boolean } = {}) {
  const clock = new VirtualClock(); const bus = createAgentBus({ onError: (e) => { throw e; } }); const sends: string[] = []; let status: EngineStatus = o.status ?? 'waiting';
  const caps = new Set<Capability>(o.caps ?? ['usage', 'compact']);
  const view = createContextView({ bus, clock, config: o.config, engines: { capabilities: () => caps, status: () => status, send: async (_id, p) => { if (o.sendFails) throw new Error('boom'); sends.push(p); } } });
  const ctxEvents: unknown[] = []; const alerts: { level: string; pct: number }[] = []; const compaction: unknown[] = []; bus.on('agent:context', (p) => ctxEvents.push(p)); bus.on('agent:context_alert', (p) => alerts.push({ level: p.level, pct: p.pct })); bus.on('agent:compaction', (p) => compaction.push(p));
  let seq = 0; const push = (b: EventBody) => view.onEvent(ev(b, ++seq));
  const usage = (used?: number, window?: number, extra: Partial<Extract<EventBody, { type: 'usage.report' }>> = {}) => push({ type: 'usage.report', input_tokens: 1, output_tokens: 1, cost_is_estimate: true, ...(used !== undefined && { context_tokens: used }), ...(window !== undefined && { context_window: window }), ...extra });
  return { clock, bus, view, sends, ctxEvents, alerts, compaction, push, usage, setStatus: (s: EngineStatus) => { status = s; } };
}
