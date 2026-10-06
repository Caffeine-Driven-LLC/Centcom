import { describe, expect, it } from 'vitest';
import { AGT, rig } from './helpers.js';

describe('thresholds and hysteresis (acceptance 1 to 3)', () => {
  it('warns once at 75%, and again only after the number falls below 65 and rises', async () => {
    const r = rig(); r.usage(150_000, 200_000); expect(r.alerts).toEqual([{ level: 'warn', pct: 75 }]);
    r.usage(151_000, 200_000); expect(r.alerts).toHaveLength(1);
    r.usage(135_000, 200_000); r.usage(150_000, 200_000); expect(r.alerts).toHaveLength(1); // 67.5 is not below 65
    r.usage(120_000, 200_000); r.usage(150_000, 200_000); expect(r.alerts.map((a) => a.level)).toEqual(['warn', 'warn']);
  });
  it('no window means no percent, reported:false, and never a warning or context-full (acceptance 2)', () => {
    const r = rig(); r.usage(190_000, undefined); r.usage(1e9, undefined); const s = r.view.snapshot(AGT); expect(s.pct).toBeUndefined(); expect(s.reported).toBe(false); expect(s.used).toBe(1e9); expect(r.alerts).toEqual([]);
  });
  it('an engine-reported percentage counts without the counts', () => { const r = rig(); r.push({ type: 'usage.report', input_tokens: 1, output_tokens: 1, cost_is_estimate: true, context_used_pct: 80 }); expect(r.view.snapshot(AGT).pct).toBe(80); expect(r.alerts).toEqual([{ level: 'warn', pct: 80 }]); });
  it('raises full once at 97% and clears it after a compaction that ends below 87%', () => {
    const r = rig(); r.usage(194_000, 200_000); expect(r.alerts.map((a) => a.level)).toEqual(['warn', 'full']); r.usage(195_000, 200_000); expect(r.alerts).toHaveLength(2);
    r.push({ type: 'compaction.started' }); r.push({ type: 'compaction.ended', tokens_before: 194_000, tokens_after: 170_000 }); expect(r.alerts.map((a) => a.level)).toEqual(['warn', 'full', 'ok']); expect(r.view.snapshot(AGT).pct).toBe(85);
    expect(r.compaction).toEqual([{ agent_id: AGT, phase: 'start' }, { agent_id: AGT, phase: 'end', before: 194_000, after: 170_000 }]);
  });
  it('a compaction that ends without numbers changes nothing it was not told', () => { const r = rig(); r.usage(194_000, 200_000); r.push({ type: 'compaction.started' }); r.push({ type: 'compaction.ended' }); expect(r.alerts.map((a) => a.level)).toEqual(['warn', 'full']); expect(r.view.snapshot(AGT).pct).toBe(97); });
  it('honours the configured thresholds', () => { const r = rig({ config: { warn_pct: 50, full_pct: 60 } }); r.usage(130_000, 200_000); expect(r.alerts.map((a) => a.level)).toEqual(['warn', 'full']); });
  it('ignores malformed numbers and keeps the known ones', () => { const r = rig(); r.push({ type: 'usage.report', input_tokens: 'x' as never, output_tokens: -4, cost_is_estimate: true, context_tokens: NaN, context_window: 200_000, cost_usd: Infinity } as never); const s = r.view.snapshot(AGT); expect(s.window).toBe(200_000); expect(s.used).toBeUndefined(); expect(s.totals).toEqual({ tokens_in: 0, tokens_out: 0 }); });
  it('shows nothing for an agent it has heard nothing from', () => { expect(rig().view.snapshot(AGT)).toEqual({ reported: false, totals: { tokens_in: 0, tokens_out: 0 } }); });
});
