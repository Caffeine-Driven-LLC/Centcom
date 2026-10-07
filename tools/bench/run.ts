/** `pnpm bench [--fast] [--filter <name>] [--update-baseline] [--baseline <file>] [--out <file>]`: runs the benchmarks, writes bench-results.json, exits 1 when a gated budget is broken or a metric regressed. */
import { cpus } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BENCHES } from './benchmarks.js';
import { breaches, judge, table, type Baseline, type BenchResults } from './compare.js';
import { calibrate, summarize } from './stats.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const a = process.argv.slice(2); const val = (f: string) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
const baselinePath = val('--baseline') ?? `${ROOT}tools/bench/baseline.json`; const outPath = val('--out') ?? `${ROOT}bench-results.json`; const filter = val('--filter');

async function main(): Promise<number> {
  let baseline: Baseline | undefined; try { baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline; } catch { /* no baseline yet: budgets only */ }
  const cal = calibrate(); const ref = baseline?.reference_calibration_ms ?? cal; const results: BenchResults['results'] = [];
  for (const b of BENCHES) {
    if (a.includes('--fast') && !b.fast) continue; if (filter && !b.id.includes(filter)) continue;
    const s = summarize(await b.run()); const raw = { id: b.id, unit: b.unit, p50: s.p50, p95: s.p95, max: s.max, cv: s.cv, budget: b.budget, gated: b.gated };
    results.push(judge(raw, baseline?.entries[b.id], cal, ref));
  }
  const out: BenchResults = { schema_version: 1, machine: { cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, node: process.version }, calibration_ms: cal, results };
  writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n'); for (const l of table(out)) console.log(l);
  if (a.includes('--update-baseline')) {
    const next: Baseline = { schema_version: 1, reference_calibration_ms: cal, entries: { ...(baseline?.entries ?? {}) } }; for (const r of results) next.entries[r.id] = { p50: r.p50 * (cal / ref), budget: r.budget, unit: r.unit, gated: r.gated };
    writeFileSync(baselinePath, JSON.stringify(next, null, 1) + '\n'); console.log(`\nBaseline written to ${baselinePath}. Say why in the commit message (a line starting "Baseline:").`); return 0;
  }
  const bad = breaches(out, baseline); if (bad.length) { console.error(`\nBudget broken or slower than the baseline: ${bad.map((r) => `${r.id} (${r.status})`).join(', ')}`); return 1; } return 0;
}
main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
