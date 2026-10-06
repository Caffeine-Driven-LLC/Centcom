import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import type { ConformanceReport, ContractReport } from './types.js';

export const REPORT_SCHEMA = JSON.parse(readFileSync(new URL('./report.schema.json', import.meta.url), 'utf8')) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }); const validate = ajv.compile(REPORT_SCHEMA);
export function validateReport(r: unknown): { ok: boolean; errors: string[] } { const ok = validate(r) as boolean; return { ok, errors: ok ? [] : (validate.errors ?? []).map((e: { instancePath?: string; message?: string }) => `${e.instancePath || '/'} ${e.message}`) }; }

export function buildReport(o: { contracts: ContractReport[]; clientVersion: string; contractVersion: string; now: Date; node: string; os: string; arch: string }): ConformanceReport {
  const c = o.contracts; const count = (s: string) => c.filter((x) => x.status === s).length;
  return { schema_version: 1, generated_at: o.now.toISOString(), client_version: o.clientVersion, contract_version: o.contractVersion, runner: { node: o.node, os: o.os, arch: o.arch },
    summary: { total: c.length, passed: count('pass'), failed: count('fail'), skipped: count('skipped') + count('waived') }, contracts: c };
}
/** 0 all pass, 1 any fail, 3 a strict violation (a contract that is client-implemented has no fixtures and no waiver). */
export function exitCode(r: ConformanceReport, o: { strict: boolean; implemented: string[] }): number {
  if (r.summary.failed > 0) return 1; if (o.strict && r.contracts.some((c) => o.implemented.includes(c.id) && c.status === 'skipped')) return 3; return 0;
}
