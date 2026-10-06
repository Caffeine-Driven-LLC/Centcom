import { describe, expect, it } from 'vitest';
import { SESSION, report, rig } from './rig.js';

describe('soft budget', () => {
  it('1.00 with 0.85 then 1.05 reported: one warn, one error, then nothing more; nothing is stopped', () => {
    const { ledger, alerts } = rig({ sessionUsd: 1 }); ledger.onUsageReport(report({ costUsd: 0.85, costCumulative: true })); expect(alerts).toEqual([{ level: 'warn', pct: 85, session_id: SESSION }]);
    ledger.onUsageReport(report({ costUsd: 1.05, costCumulative: true })); ledger.onUsageReport(report({ costUsd: 1.5, costCumulative: true }));
    expect(alerts.map((a) => a.level)).toEqual(['warn', 'error']); expect(ledger.snapshot({}).costUsdReported).toBeCloseTo(1.5);
  });
  it('a jump straight past 100 % gives both, once', () => {
    const { ledger, alerts } = rig({ sessionUsd: 1 }); ledger.onUsageReport(report({ costUsd: 2 })); expect(alerts.map((a) => a.level)).toEqual(['warn', 'error']);
  });
  it('no alert when no cost is reported, or no budget is set', () => {
    const a = rig({ sessionUsd: 1 }); a.ledger.onUsageReport(report({ tokensIn: 1e9 })); expect(a.alerts).toEqual([]);
    const b = rig(); b.ledger.onUsageReport(report({ costUsd: 50 })); expect(b.alerts).toEqual([]);
  });
});
