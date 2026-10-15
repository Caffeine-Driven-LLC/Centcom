import { describe, expect, it } from 'vitest';
import { BudgetGuard, DemoEngine, type NormalisedEvent } from '@centcom/agent';
import { AppController } from '../../src/index.js';
import { layoutStatus, renderStatus, statusFieldsFor, statusText } from '../../src/status/index.js';
import { runMeterText } from '../../src/status/fromState.js';

const base = { v: 1 as const, seq: 1, ts: '', agent_id: 'a' };
const progress = (out: number): NormalisedEvent => ({ ...base, type: 'usage.progress', message_id: 'm', scope: 'main', input_tokens: 5, output_tokens: out });
const mk = (limits = {}) => new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', branch: 'main', version: 't', skills: [], budget: new BudgetGuard(limits) });
const footer = (c: AppController, now?: number) => renderStatus(layoutStatus(statusFieldsFor(c.state, { now }), 200, undefined, 'footer'), 200);

describe('the live meter in the footer', () => {
  it('is not there before the first request', () => { const c = mk(); expect(runMeterText(c.state)).toBeUndefined(); expect(footer(c)).not.toContain('run '); c.stop(); });
  it('counts each request as it finishes, against the run limits, with the rate while it works', () => {
    const c = mk(); c.apply({ ...base, type: 'turn.started', turn_id: 't' } as NormalisedEvent);
    for (let i = 0; i < 12; i++) c.apply(progress(3000)); c.apply({ ...base, type: 'usage.report', input_tokens: 1, output_tokens: 36000, cost_usd: 0.41, cost_is_estimate: true } as NormalisedEvent);
    const start = c.state.meter!.startedAt; const f = footer(c, start + 2 * 60_000);
    expect(f).toContain('run 12/60 req · ↓36k/400k · $0.41/5.00'); expect(f).toContain('~18k/min'); c.stop();
  });
  it('turns to a warning near a limit and says paused; shows plain numbers when the guard is off; the screen-reader line has it too', () => {
    const c = mk({ runRequests: 10, runOutputTokens: 0, runUsd: 0 }); for (let i = 0; i < 8; i++) c.apply(progress(10));
    const m = runMeterText(c.state)!; expect(m.warn).toBe(true); expect(m.text).toContain('8/10 req'); expect(statusText(statusFieldsFor(c.state))).toContain('run 8/10 req');
    c.apply(progress(10)); c.apply(progress(10)); expect(runMeterText(c.state)!.text).toContain('paused'); c.stop();
    const off = mk({ enabled: false }); off.apply(progress(10)); expect(runMeterText(off.state)!.text).toBe('run 1 req · ↓10'); off.stop();
  });
});
