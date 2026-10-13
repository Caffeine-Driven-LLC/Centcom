/** The consumer-side integration gates (lane C100): a gate is a list of steps run against a backend, `mock` (started here) or a real base URL, with the SAME steps for both.
 *  A step that throws fails the gate, the steps after it are `skipped` (never a partial pass), and an unreachable backend is reported as `backend_unreachable`.
 *  Reports hold step ids, statuses and durations only: never a token, a key, a code or a message body. */
export interface StepResult { id: string; status: 'pass' | 'fail' | 'skipped'; duration_ms: number; evidence?: string }
export interface GateReport { gate: string; passed: boolean; steps: StepResult[]; started_at: string; ended_at: string }
export interface Step<C> { id: string; run(ctx: C): Promise<string | void> }
export class GateFailure extends Error { constructor(readonly code: string, message: string) { super(message); this.name = 'GateFailure'; } }

const iso = (ms: number): string => new Date(ms).toISOString();
/** Network errors from fetch or the HTTP client, as a code the report can carry. */
export function failureCode(e: unknown): string {
  if (e instanceof GateFailure) return e.code;
  const o = e as { name?: string; transport?: string; rawCode?: string; code?: string; cause?: { code?: string } };
  if (o?.name === 'TransportError' || o?.cause?.code === 'ECONNREFUSED' || o?.code === 'ECONNREFUSED') return 'backend_unreachable';
  if (typeof o?.rawCode === 'string') return o.rawCode; if (typeof o?.code === 'string') return o.code; return 'step_failed';
}
export async function runSteps<C>(gate: string, ctx: C, steps: Step<C>[], now: () => number = Date.now): Promise<GateReport> {
  const started = now(); const out: StepResult[] = []; let failed = false;
  for (const s of steps) {
    if (failed) { out.push({ id: s.id, status: 'skipped', duration_ms: 0 }); continue; }
    const t0 = now();
    try { const evidence = await s.run(ctx); out.push({ id: s.id, status: 'pass', duration_ms: now() - t0, ...(evidence ? { evidence } : {}) }); }
    catch (e) { failed = true; out.push({ id: s.id, status: 'fail', duration_ms: now() - t0, evidence: failureCode(e) }); }
  }
  return { gate, passed: !failed && out.length > 0, steps: out, started_at: iso(started), ended_at: iso(now()) };
}
