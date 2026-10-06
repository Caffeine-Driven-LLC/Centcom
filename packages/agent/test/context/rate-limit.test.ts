import { describe, expect, it } from 'vitest';
import { AGT, rig } from './helpers.js';

describe('agent:context rate (acceptance 7)', () => {
  it('100 reports inside one second give at most one per second, and the last value arrives', async () => {
    const r = rig(); for (let i = 0; i < 100; i++) { r.usage(1000 + i, 200_000); await r.clock.advance(5); } expect(r.ctxEvents.length).toBeLessThanOrEqual(2); await r.clock.advance(1000);
    expect(r.ctxEvents.length).toBeLessThanOrEqual(2 + 1); expect(r.ctxEvents.at(-1)).toMatchObject({ agent_id: AGT, used: 1099, window: 200_000 });
  });
  it('never more than one in any 1,000 ms window over a long run', async () => { const r = rig(); const at: number[] = []; r.bus.on('agent:context', () => at.push(r.clock.now())); for (let i = 0; i < 400; i++) { r.usage(i, 1000); await r.clock.advance(37); } await r.clock.advance(1000); for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(1000); });
  it('a quiet agent has no timer left, and an exit clears a pending one', async () => { const r = rig(); const off = r.view.attach(); r.usage(1, 10); r.usage(2, 10); expect(r.clock.pending()).toBe(1); r.bus.emit('agent:exited', { agent_id: AGT, outcome: 'ok' }); expect(r.clock.pending()).toBe(0); off(); r.view.dispose(); });
  it('attach follows the bus', () => { const r = rig(); const off = r.view.attach(); r.bus.emit('agent:event', { agent_id: AGT, seq: 1, event: { type: 'usage.report', input_tokens: 9, output_tokens: 0, cost_is_estimate: true, v: 1, seq: 1, ts: 't', agent_id: AGT } as never }); expect(r.view.snapshot(AGT).totals.tokens_in).toBe(9); off(); r.bus.emit('agent:event', { agent_id: AGT, seq: 2, event: { type: 'usage.report', input_tokens: 9, output_tokens: 0, cost_is_estimate: true, v: 1, seq: 2, ts: 't', agent_id: AGT } as never }); expect(r.view.snapshot(AGT).totals.tokens_in).toBe(9); });
});
