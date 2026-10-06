import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluate, type Inputs } from './check.js';
import { gather, main } from './run.js';

const good = (): Inputs => ({ conformance: { summary: { total: 17, failed: 0 } }, coverage: { protocol: 91, net: 84 }, bench: { breaches: [] }, security: { findings: [{ severity: 'low' }] }, artifacts: { artifacts: [{ name: 'centcom-linux-x64', sha256: 'a'.repeat(64), signature: 'sig' }], sbom: 'sbom.json' }, contractLock: { ok: true }, docs: { ok: true }, installers: { ok: true }, update: { ok: true } });
describe('release gate', () => {
  it('passes with everything green', () => { const r = evaluate(good()); expect(r.passed).toBe(true); expect(r.checks).toHaveLength(9); });
  const flips: [string, (i: Inputs) => void][] = [
    ['conformance failed', (i) => { i.conformance = { summary: { total: 17, failed: 1 } }; }], ['conformance ran nothing', (i) => { i.conformance = { summary: { total: 0, failed: 0 } }; }],
    ['coverage below 80 in one package', (i) => { i.coverage = { protocol: 91, net: 79.9 }; }], ['no coverage numbers', (i) => { i.coverage = {}; }],
    ['bench budget breach', (i) => { i.bench = { breaches: [{ name: 'startup' }] }; }], ['a high security finding', (i) => { i.security = { findings: [{ severity: 'High' }] }; }], ['a critical security finding', (i) => { i.security = { findings: [{ severity: 'critical' }] }; }],
    ['an unsigned artifact', (i) => { i.artifacts!.artifacts[0]!.signature = undefined; }], ['no SBOM', (i) => { i.artifacts!.sbom = null; }], ['no artifacts', (i) => { i.artifacts = { artifacts: [], sbom: 'x' }; }],
    ['contract lock mismatch', (i) => { i.contractLock = { ok: false }; }], ['docs failed', (i) => { i.docs = { ok: false }; }], ['installers failed', (i) => { i.installers = { ok: false }; }], ['update failed', (i) => { i.update = { ok: false }; }],
  ];
  for (const [name, f] of flips) it(`fails on: ${name}`, () => { const i = good(); f(i); expect(evaluate(i).passed).toBe(false); });
  it('a missing report is a failure, never a pass', () => { for (const k of Object.keys(good()) as (keyof Inputs)[]) { const i = good(); delete i[k]; const r = evaluate(i); expect(r.passed).toBe(false); expect(r.checks.filter((c) => !c.ok)).toHaveLength(1); } });
  it('the runner reads the report files and exits 0 or 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-rg-')); const w = (n: string, v: unknown) => writeFileSync(join(dir, n), JSON.stringify(v)); const g = good();
    w('conformance-report.json', g.conformance); w('coverage-summary.json', { packages: g.coverage }); w('bench-report.json', g.bench); w('security-report.json', g.security); w('artifacts.json', g.artifacts); w('docs-report.json', g.docs); w('installers-report.json', g.installers); w('update-report.json', g.update);
    expect(gather(dir, () => true).coverage).toEqual({ protocol: 91, net: 84 }); const out: string[] = []; expect(main(['--dir', dir], (l) => out.push(l))).toBe(0); expect(out.at(-1)).toBe('Release gate: passed');
    w('security-report.json', { findings: [{ severity: 'high' }] }); const o2: string[] = []; expect(main(['--dir', dir], (l) => o2.push(l))).toBe(1); expect(o2.some((l) => l.startsWith('FAIL security'))).toBe(true);
    writeFileSync(join(dir, 'bench-report.json'), '{not json'); expect(gather(dir, () => true).bench).toBeUndefined(); expect(main(['--dir', join(dir, 'empty')], () => undefined)).toBe(1);
  }, 60_000);
});
