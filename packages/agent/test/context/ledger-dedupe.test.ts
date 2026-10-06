import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AGT, rig } from './helpers.js';

describe('usage ledger (acceptance 6)', () => {
  it('a replayed 1,000-message transcript counts each message once', () => {
    const r = rig(); let sum = 0; const msgs = Array.from({ length: 1000 }, (_, i) => { const n = (i % 7) + 1; sum += n; return { id: `m${i}`, n }; });
    for (const pass of [1, 2]) for (const m of msgs) r.usage(undefined, undefined, { message_id: m.id, input_tokens: m.n, output_tokens: 0 }); expect(r.view.snapshot(AGT).totals.tokens_in).toBe(sum);
  });
  it('totals never decrease and do not depend on order (1,000 shuffled reports)', () => {
    fc.assert(fc.property(fc.shuffledSubarray(Array.from({ length: 1000 }, (_, i) => i), { minLength: 1000, maxLength: 1000 }), (order) => {
      const r = rig(); let prev = 0; for (const i of order) { r.usage(undefined, undefined, { message_id: `m${i}`, input_tokens: i % 5, output_tokens: 1, cost_usd: 0.001 }); const t = r.view.snapshot(AGT).totals; expect(t.tokens_in).toBeGreaterThanOrEqual(prev); prev = t.tokens_in; }
      const t = r.view.snapshot(AGT).totals; expect(t.tokens_in).toBe(order.reduce((s, i) => s + (i % 5), 0)); expect(t.tokens_out).toBe(1000); expect(t.cost_usd).toBeCloseTo(1, 6);
    }), { numRuns: 20 });
  });
  it('a report without a message id is told apart by its sequence number', () => { const r = rig(); r.usage(undefined, undefined, { input_tokens: 5 }); r.usage(undefined, undefined, { input_tokens: 5 }); expect(r.view.snapshot(AGT).totals.tokens_in).toBe(10); });
  it('agents are kept apart', () => { const r = rig(); r.usage(undefined, undefined, { message_id: 'a', input_tokens: 3 }); r.view.onEvent({ type: 'usage.report', input_tokens: 4, output_tokens: 0, cost_is_estimate: true, message_id: 'a', v: 1, seq: 1, ts: 't', agent_id: 'agt_other' } as never); expect(r.view.snapshot(AGT).totals.tokens_in).toBe(3); expect(r.view.snapshot('agt_other' as never).totals.tokens_in).toBe(4); });
});
