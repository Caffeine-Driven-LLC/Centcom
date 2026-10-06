import { newIdGenerator } from '@centcom/protocol';
import { createAgentBus, createLedger, type OutboxFs, type UsageReport } from '../../src/index.js';

/** An in-memory outbox file, a settable clock and a ledger on them. */
export function rig(o: { sessionUsd?: number; files?: Map<string, string>; now?: number } = {}) {
  const files = o.files ?? new Map<string, string>(); let t = o.now ?? Date.UTC(2026, 9, 6, 12); let rnd = 0;
  const fs: OutboxFs = { read: async (p) => files.get(p), writeAtomic: async (p, text) => { files.set(p, text); } };
  const ids = newIdGenerator({ now: () => t, random: (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (rnd++ * 37 + i) & 255; return b; } });
  const bus = createAgentBus({ onError: (e) => { throw e; } }); const alerts: { level: string; pct: number; session_id: string }[] = []; bus.on('cost.alert', (a) => alerts.push(a));
  const ledger = createLedger({ clock: { now: () => t, setTimeout: () => 0 as never, clearTimeout: () => undefined } as never, ids: { next: () => ids.next('use') }, bus, fs, outboxPath: '/data/usage/outbox.jsonl', config: { sessionUsd: o.sessionUsd } });
  return { ledger, files, alerts, advance: (ms: number) => { t += ms; }, at: () => new Date(t) };
}
export const AGENT = 'agt_01JTEST0000000000000000001'; export const SESSION = 'ses_01JTEST0000000000000000001';
export const report = (o: Partial<UsageReport>): UsageReport => ({ agentId: AGENT, engine: 'claude-code', engineSessionId: 'es1', sessionId: SESSION, cumulative: false, ...o });
