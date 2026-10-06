import { describe, expect, it } from 'vitest';
import { report, rig } from './rig.js';

describe('cumulative reports', () => {
  it('1,000 then 1,600 input tokens count 1,600, not 2,600', () => {
    const { ledger } = rig(); ledger.onUsageReport(report({ cumulative: true, tokensIn: 1000 })); ledger.onUsageReport(report({ cumulative: true, tokensIn: 1600 })); expect(ledger.snapshot({}).tokensIn).toBe(1600);
    const qty = ledger.dequeueBatch().filter((e) => e.type === 'tokens_in').map((e) => e.qty); expect(qty).toEqual([1000, 600]);
  });
  it('a drop to 200 on a new engine session starts a new baseline', () => {
    const { ledger } = rig(); ledger.onUsageReport(report({ cumulative: true, tokensIn: 1600 })); ledger.onUsageReport(report({ cumulative: true, engineSessionId: 'es2', tokensIn: 200 })); expect(ledger.snapshot({}).tokensIn).toBe(1800);
    ledger.onUsageReport(report({ cumulative: true, engineSessionId: 'es2', tokensIn: 250 })); expect(ledger.snapshot({}).tokensIn).toBe(1850);
  });
  it('a total that goes down on the same session is a new baseline too', () => {
    const { ledger } = rig(); ledger.onUsageReport(report({ cumulative: true, tokensIn: 900 })); ledger.onUsageReport(report({ cumulative: true, tokensIn: 100 })); expect(ledger.snapshot({}).tokensIn).toBe(1000);
  });
});
