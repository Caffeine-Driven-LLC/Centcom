/** The conformance runner's shapes (lane C100). */
export type ContractStatus = 'pass' | 'fail' | 'skipped' | 'waived';
export interface CaseResult { name: string; ok: boolean; detail?: string }
/** What a suite returns: one entry per fixture or check it ran. */
export interface SuiteResult { fixtures_total: number; fixtures_passed: number; cases: CaseResult[] }
export interface Suite { contract: string; /** Fixture folders under contracts/fixtures this suite reads. */ areas: string[]; run(ctx: SuiteContext): Promise<SuiteResult> | SuiteResult }
export interface SuiteContext { fixtures: FixtureSet; contractsDir: string }
export interface Fixture { area: string; file: string; json: unknown }
export type FixtureSet = { all: Fixture[]; area(name: string): Fixture[] };
export interface Waiver { contract: string; reason: string; issue: string; /** YYYY-MM-DD */ expires: string }
export interface ContractReport { id: string; status: ContractStatus; fixtures_total: number; fixtures_passed: number; waiver?: { issue: string; reason: string; expires: string }; failures?: string[] }
export interface ConformanceReport {
  schema_version: 1; generated_at: string; client_version: string; contract_version: string; runner: { node: string; os: string; arch: string };
  summary: { total: number; passed: number; failed: number; skipped: number }; contracts: ContractReport[];
}
