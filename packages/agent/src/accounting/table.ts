/** The `/usage` table: every cost is followed by `est.`, a missing one says `not reported`. */
import type { DayTotals, LedgerTotals } from './types.js';

const n = (v: number) => v.toLocaleString('en-US');
export const costText = (t: LedgerTotals) => (t.costUsdReported === null ? 'not reported' : `$${t.costUsdReported.toFixed(t.costUsdReported < 1 ? 4 : 2)} est.`);
const mins = (ms: number) => `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
export function usageTable(rows: { label: string; t: LedgerTotals }[], days: DayTotals[] = []): string[] {
  const out = ['                 tokens in   tokens out   cache read   agent time   cost']; const line = (label: string, t: LedgerTotals) => `${label.padEnd(16).slice(0, 16)} ${n(t.tokensIn).padStart(10)} ${n(t.tokensOut).padStart(12)} ${n(t.cacheRead).padStart(12)} ${mins(t.agentMs).padStart(12)}   ${costText(t)}`;
  for (const r of rows) out.push(line(r.label, r.t)); for (const d of days) out.push(line(d.day, d));
  out.push('Costs are what the tools reported, as estimates. Nothing is billed or limited from these numbers.'); return out;
}
