/** The release gate (lane C100): every input must be present and good, or the release does not go out. Pure: it only judges what it is given. */
export interface Inputs {
  conformance?: { summary: { total: number; failed: number } };
  /** line coverage in percent per package */ coverage?: Record<string, number>;
  bench?: { breaches: unknown[] };
  security?: { findings: { severity: string; id?: string }[] };
  artifacts?: { artifacts: { name: string; sha256?: string; signature?: string }[]; sbom?: string | null };
  contractLock?: { ok: boolean };
  docs?: { ok: boolean };
  installers?: { ok: boolean };
  update?: { ok: boolean };
}
export interface Check { id: string; required: boolean; ok: boolean; detail: string }
export const COVERAGE_FLOOR = 80;

const need = <T>(id: string, v: T | undefined, f: (v: T) => { ok: boolean; detail: string }): Check => (v === undefined ? { id, required: true, ok: false, detail: 'no report was provided' } : { id, required: true, ...f(v) });
export function evaluate(i: Inputs): { passed: boolean; checks: Check[] } {
  const checks: Check[] = [
    need('conformance', i.conformance, (c) => ({ ok: c.summary.total > 0 && c.summary.failed === 0, detail: c.summary.total === 0 ? 'no contracts were run' : `${c.summary.failed} failed of ${c.summary.total}` })),
    need('coverage', i.coverage, (c) => { const low = Object.entries(c).filter(([, p]) => !(p >= COVERAGE_FLOOR)); return { ok: Object.keys(c).length > 0 && low.length === 0, detail: Object.keys(c).length === 0 ? 'no packages measured' : low.length ? `below ${COVERAGE_FLOOR}%: ${low.map(([n, p]) => `${n} ${p}%`).join(', ')}` : `all packages at or above ${COVERAGE_FLOOR}%` }; }),
    need('bench', i.bench, (b) => ({ ok: b.breaches.length === 0, detail: `${b.breaches.length} budget breaches` })),
    need('security', i.security, (s) => { const high = s.findings.filter((f) => ['high', 'critical'].includes(f.severity.toLowerCase())); return { ok: high.length === 0, detail: `${high.length} high or critical findings` }; }),
    need('artifacts', i.artifacts, (a) => { const bad = a.artifacts.filter((x) => !x.signature || !x.sha256); const noSbom = !a.sbom; return { ok: a.artifacts.length > 0 && bad.length === 0 && !noSbom, detail: a.artifacts.length === 0 ? 'no artifacts' : bad.length ? `unsigned: ${bad.map((x) => x.name).join(', ')}` : noSbom ? 'SBOM missing' : 'all signed, SBOM present' }; }),
    need('contract-lock', i.contractLock, (c) => ({ ok: c.ok, detail: c.ok ? 'lock matches' : 'the contract lock check failed' })),
    need('docs', i.docs, (c) => ({ ok: c.ok, detail: c.ok ? 'docs check passed' : 'the docs check failed' })),
    need('installers', i.installers, (c) => ({ ok: c.ok, detail: c.ok ? 'installers verified' : 'installer verification failed' })),
    need('update', i.update, (c) => ({ ok: c.ok, detail: c.ok ? 'update path verified' : 'update verification failed' })),
  ];
  return { passed: checks.every((c) => !c.required || c.ok), checks };
}
