import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GateFailure, failureCode, runSteps } from './gate.js';
import { GATES, main, runGate } from './run.js';

describe('gate runner', () => {
  it('a failing step fails the gate, the rest are skipped (never a partial pass), and durations come from the injected clock', async () => {
    let t = 0; const r = await runSteps('GX', {}, [{ id: 'a', async run() { t += 5; return 'fine'; } }, { id: 'b', async run() { t += 7; throw new GateFailure('boom', 'secret detail'); } }, { id: 'c', async run() { return 'never'; } }], () => t);
    expect(r.passed).toBe(false); expect(r.steps).toEqual([{ id: 'a', status: 'pass', duration_ms: 5, evidence: 'fine' }, { id: 'b', status: 'fail', duration_ms: 7, evidence: 'boom' }, { id: 'c', status: 'skipped', duration_ms: 0 }]);
    expect(JSON.stringify(r)).not.toContain('secret detail'); expect(r.started_at).toBe('1970-01-01T00:00:00.000Z');
    expect((await runSteps('GY', {}, [], () => 0)).passed).toBe(false);
  });
  it('failure codes: a refused connection is backend_unreachable, an API code is passed on, anything else is step_failed', () => {
    expect(failureCode(Object.assign(new Error('x'), { name: 'TransportError' }))).toBe('backend_unreachable'); expect(failureCode({ cause: { code: 'ECONNREFUSED' } })).toBe('backend_unreachable'); expect(failureCode({ rawCode: 'invalid_grant' })).toBe('invalid_grant'); expect(failureCode(new Error('x'))).toBe('step_failed'); expect(failureCode(null)).toBe('step_failed');
  });
});
describe('gates against the mock backend', () => {
  it('G1: device-flow login then GET /v1/me passes in under 30 s, and the report holds no token or code', async () => {
    const t0 = Date.now(); const r = await runGate('G1', { backend: 'mock' }); expect(Date.now() - t0).toBeLessThan(30_000);
    expect(r.passed).toBe(true); expect(r.steps.map((s) => s.id)).toEqual(['device-login-start', 'device-login-approved', 'get-me', 'get-me-needs-a-token']); expect(r.steps.every((s) => s.status === 'pass')).toBe(true);
    const text = JSON.stringify(r); expect(text).not.toMatch(/eyJ|rt_|dc_|[A-Z2-9]{4}-[A-Z2-9]{4}/);
  }, 40_000);
  it('G1 against a backend that is not there fails with backend_unreachable and skips the rest', async () => {
    const r = await runGate('G1', { backend: 'http://127.0.0.1:9' }); expect(r.passed).toBe(false); expect(r.steps[0]).toMatchObject({ status: 'fail', evidence: 'backend_unreachable' }); expect(r.steps.slice(1).every((s) => s.status === 'skipped')).toBe(true);
  }, 30_000);
  it('G2 to G5 are not built and say so (a failure, never a pass); G6 therefore fails; the CLI writes the report and exits 1', async () => {
    for (const g of ['G2', 'G3', 'G4', 'G5'] as const) { const r = await runGate(g, { backend: 'mock' }); expect(r.passed, g).toBe(false); expect(r.steps[0]).toMatchObject({ id: 'built', status: 'fail', evidence: 'not_built' }); }
    const out = join(mkdtempSync(join(tmpdir(), 'cc-gate-')), 'r.json'); const lines: string[] = []; expect(await main(['G2', '--out', out], (l) => lines.push(l))).toBe(1); expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({ gate: 'G2', passed: false }); expect(lines.at(-1)).toBe('Gate G2: NOT passed');
  });
  it('bad usage is exit 2', async () => { expect(await main([], () => undefined)).toBe(2); expect(await main(['G9'], () => undefined)).toBe(2); expect(await main(['G1', '--backend', 'ftp://x'], () => undefined)).toBe(2); expect(GATES).toHaveLength(6); });
});
