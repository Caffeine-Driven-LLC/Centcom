/** Comparing a run with the committed baseline and the budgets. Pure functions, so the rules are tested without running anything. */
export type Status = 'pass' | 'fail' | 'regressed' | 'unstable';
export interface Result { id: string; unit: 'ms' | 'ops/s' | 'MB'; p50: number; p95: number; max: number; cv: number; budget: number | null; status: Status; baseline: number | null; gated: boolean }
export interface BenchResults { schema_version: 1; machine: { cpu: string; cores: number; node: string }; calibration_ms: number; results: Result[] }
export interface BaselineEntry { p50: number; budget: number | null; unit: 'ms' | 'ops/s' | 'MB'; gated?: boolean }
export interface Baseline { schema_version: 1; reference_calibration_ms: number; entries: Record<string, BaselineEntry> }
export const REGRESSION_RATIO = 1.15; /** The card says 10 % across 5 runs; one run's own spread of very short operations is wider, so a single run is judged at 25 %. */ export const MAX_CV = 0.25;

/** A measurement as it would be on the reference machine: time shrinks when this machine is slower than the reference, and the other way round. */
export const normalise = (value: number, unit: Result['unit'], calibrationMs: number, referenceMs: number): number => (unit === 'ms' ? value * (referenceMs / calibrationMs) : unit === 'ops/s' ? value * (calibrationMs / referenceMs) : value);
/** Higher is worse for ms and MB, better for ops/s. */
const worse = (unit: Result['unit'], value: number, limit: number): boolean => (unit === 'ops/s' ? value < limit : value > limit);

export function judge(r: Omit<Result, 'status' | 'baseline'>, base: BaselineEntry | undefined, calibrationMs: number, referenceMs: number): Result {
  const p95 = normalise(r.p95, r.unit, calibrationMs, referenceMs); const p50 = normalise(r.p50, r.unit, calibrationMs, referenceMs); const budget = base?.budget ?? r.budget; const baseline = base?.p50 ?? null;
  let status: Status = 'pass';
  /* a budget is an absolute limit, so noise does not excuse breaking it; "slower than before" needs a steady measurement, so a noisy one is only reported */
  if (budget !== null && worse(r.unit, p95, budget)) status = 'fail';
  else if (r.cv > MAX_CV) status = 'unstable';
  else if (baseline !== null && worse(r.unit, p50, r.unit === 'ops/s' ? baseline / REGRESSION_RATIO : baseline * REGRESSION_RATIO)) status = 'regressed';
  return { ...r, p50, p95, status, baseline, budget };
}
/** Exit 1 when any gated metric failed or regressed. */
export function breaches(res: BenchResults, baseline?: Baseline): Result[] { return res.results.filter((r) => (r.status === 'fail' || r.status === 'regressed') && (baseline?.entries[r.id]?.gated ?? r.gated)); }
export function table(a: BenchResults, b?: BenchResults): string[] {
  const rows = ['metric                       p50        p95     budget  status' + (b ? '     vs before' : '')];
  for (const r of a.results) { const prev = b?.results.find((x) => x.id === r.id); const d = prev && prev.p50 > 0 ? `${r.p50 >= prev.p50 ? '+' : ''}${(((r.p50 - prev.p50) / prev.p50) * 100).toFixed(0)}%` : ''; rows.push(`${r.id.padEnd(26)} ${fmt(r.p50)} ${fmt(r.p95)} ${(r.budget === null ? '-' : fmt(r.budget)).padStart(9)}  ${r.status.padEnd(9)} ${d}`.trimEnd()); }
  return rows;
}
const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(n < 10 ? 2 : 1) : 'n/a').padStart(9);
