/** Runs the checks in parallel, each with its own limit, inside an overall limit. A check that throws is a failure, never a crash. */
import { ALL_CHECKS, NETWORK_TIMEOUT_MS } from './checks.js';
import type { CheckReport, DoctorCheck, DoctorContext, DoctorReport } from './types.js';

export const DEFAULT_TIMEOUT_MS = 8000;
export interface Timers { setTimeout(f: () => void, ms: number): unknown; clearTimeout(h: unknown): void; now(): number }
const real: Timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout), now: () => Date.now() };
export async function runChecks(ctx: DoctorContext, o: { only?: string[]; timeoutMs?: number; checks?: DoctorCheck[]; timers?: Timers } = {}): Promise<DoctorReport> {
  const t = o.timers ?? real; const total = o.timeoutMs ?? DEFAULT_TIMEOUT_MS; const list = (o.checks ?? ALL_CHECKS).filter((c) => !o.only?.length || o.only.includes(c.id));
  const one = async (c: DoctorCheck): Promise<CheckReport> => {
    const t0 = t.now(); const limit = Math.min(total, c.network ? NETWORK_TIMEOUT_MS + 500 : total); let h: unknown;
    const timeout = new Promise<'timeout'>((res) => { h = t.setTimeout(() => res('timeout'), limit); });
    try { const r = await Promise.race([c.run(ctx), timeout]); if (r === 'timeout') return { id: c.id, status: c.network ? 'fail' : 'warn', summary: 'did not answer in time', next_step: c.network ? 'check your internet connection or proxy' : 'run doctor again', duration_ms: t.now() - t0 }; return { id: c.id, ...r, duration_ms: t.now() - t0 }; }
    catch { return { id: c.id, status: 'fail', summary: 'the check itself failed', next_step: 'run doctor again; if it keeps failing, run: centcom doctor --bundle report.tar.gz', duration_ms: t.now() - t0 }; }
    finally { t.clearTimeout(h); }
  };
  return { schema_version: 1, version: ctx.version, contract: ctx.contract, checks: await Promise.all(list.map(one)) };
}
/** 0 all pass (or skip), 1 warnings only, 2 any failure. */
export const exitCodeOf = (r: DoctorReport): number => (r.checks.some((c) => c.status === 'fail') ? 2 : r.checks.some((c) => c.status === 'warn') ? 1 : 0);
export const REPORT_SCHEMA = { type: 'object', required: ['schema_version', 'version', 'contract', 'checks'], additionalProperties: false, properties: { schema_version: { const: 1 }, version: { type: 'string' }, contract: { type: 'string' }, checks: { type: 'array', items: { type: 'object', required: ['id', 'status', 'summary', 'duration_ms'], additionalProperties: false, properties: { id: { type: 'string' }, status: { enum: ['pass', 'warn', 'fail', 'skip'] }, summary: { type: 'string' }, next_step: { type: 'string' }, duration_ms: { type: 'number', minimum: 0 } } } } } } as const;
