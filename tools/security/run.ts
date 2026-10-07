/** `pnpm security:check [--fast] [--out security-report.json]`: exit 1 on any failing check. `--fast` skips the audit (network) and the licence walk of node_modules. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkAudit, defaultAudit, type AuditRunner } from './audit.js';
import { checkInstalledLicences, type LicencePolicy } from './licences.js';
import { checkLockfileAt } from './lockfile.js';
import { checkPackages } from './packages.js';
import { checkSecrets, trackedFiles, type SecretsPolicy } from './secrets.js';
import type { CheckResult, SecurityReport } from './types.js';
import { applyWaivers, validateWaivers } from './waivers.js';
import { checkWorkflows, type ActionPolicy } from './workflows.js';

const here = dirname(fileURLToPath(import.meta.url)); const defaultRoot = resolve(here, '../..');
export interface Options { root?: string; fast?: boolean; now?: Date; audit?: AuditRunner; policy?: { licences: LicencePolicy; actions: ActionPolicy; secrets: SecretsPolicy }; waivers?: unknown }
export function runChecks(o: Options = {}): SecurityReport {
  const root = o.root ?? defaultRoot; const now = o.now ?? new Date(); const policy = o.policy ?? JSON.parse(readFileSync(join(here, 'policy.json'), 'utf8')) as NonNullable<Options['policy']>;
  const { valid, problems } = validateWaivers(o.waivers ?? JSON.parse(readFileSync(join(here, 'waivers.json'), 'utf8')), now.getTime());
  let files: string[] = []; let filesErr: string | undefined; try { files = trackedFiles(root); } catch (e) { filesErr = (e as Error).message; }
  const checks: CheckResult[] = [filesErr ? { id: 'secrets', status: 'fail', findings: [{ severity: 'high', location: 'secrets', message: `tool_unavailable: ${filesErr}` }] } : checkSecrets(root, () => files, policy.secrets), ...checkPackages(root, files), checkLockfileAt(root), checkWorkflows(root, policy.actions)];
  if (!o.fast) { checks.push(checkInstalledLicences(root, policy.licences)); checks.push(checkAudit(o.audit ?? defaultAudit(root))); }
  const bad = problems.map((p): CheckResult => ({ id: 'waivers', status: 'fail', findings: [{ severity: 'high', location: 'tools/security/waivers.json', message: p }] }));
  return { schema_version: 1, generated_at: now.toISOString(), checks: [...applyWaivers(checks, valid), ...bad], waivers: valid.map((w) => ({ id: w.id, issue: w.issue, expires: w.expires })) };
}
export const failed = (r: SecurityReport): boolean => r.checks.some((c) => c.status === 'fail');
export function main(argv: string[], log: (l: string) => void = console.log): number {
  const { values } = parseArgs({ args: argv, options: { fast: { type: 'boolean' }, out: { type: 'string' } } }); const r = runChecks({ fast: values.fast });
  writeFileSync(values.out ?? join(defaultRoot, 'security-report.json'), JSON.stringify(r, null, 2) + '\n');
  for (const c of r.checks) { log(`${c.status.padEnd(6)} ${c.id}${c.findings.length ? ` (${c.findings.length})` : ''}`); for (const f of c.findings.slice(0, 5)) log(`         ${f.severity} ${f.location}: ${f.message}`); if (c.findings.length > 5) log(`         ... and ${c.findings.length - 5} more`); }
  return failed(r) ? 1 : 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exit(main(process.argv.slice(2)));
