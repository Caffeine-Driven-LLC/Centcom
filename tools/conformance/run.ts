/** `pnpm conformance [--contract CT-X ...] [--json] [--out file] [--strict]`. Exit 0 all pass, 1 any fail, 3 strict violation. Runs offline. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CONTRACT_VERSION } from '../../packages/protocol/src/index.js';
import { buildReport, exitCode, loadFixtures, runSuites, validateReport, validateWaivers } from '../../packages/testkit/src/index.js';
import { SUITES } from './suites.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'); const contractsDir = join(root, 'contracts');
export async function conformance(argv: string[], now = new Date(), log: (l: string) => void = console.log): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { contract: { type: 'string', multiple: true }, json: { type: 'boolean' }, out: { type: 'string' }, strict: { type: 'boolean' }, waivers: { type: 'string' } } });
  const index = JSON.parse(readFileSync(join(contractsDir, 'index.json'), 'utf8')) as { contracts: { id: string; implemented_by: string[] }[] };
  const implemented = index.contracts.filter((c) => c.implemented_by.includes('client')).map((c) => c.id); const ids = index.contracts.map((c) => c.id);
  for (const c of values.contract ?? []) if (!ids.includes(c)) { console.error(`unknown contract ${c}`); return 2; }
  const wfile = values.waivers ?? join(root, 'packages/testkit/src/conformance/waivers.json'); const { valid, problems } = validateWaivers(JSON.parse(readFileSync(wfile, 'utf8')), now.getTime());
  for (const p of problems) console.error(`waiver: ${p}`); if (problems.length) return 2;
  const contracts = await runSuites({ suites: SUITES, contracts: implemented, only: values.contract, ctx: { fixtures: loadFixtures(contractsDir), contractsDir }, waivers: valid });
  const pkg = JSON.parse(readFileSync(join(root, 'apps/cli/package.json'), 'utf8')) as { version: string };
  const report = buildReport({ contracts, clientVersion: pkg.version, contractVersion: CONTRACT_VERSION, now, node: process.versions.node, os: process.platform, arch: process.arch });
  const v = validateReport(report); if (!v.ok) { console.error(`internal: report does not match its schema: ${v.errors.join('; ')}`); return 2; }
  if (values.out) writeFileSync(values.out, JSON.stringify(report, null, 2) + '\n');
  if (values.json) log(JSON.stringify(report)); else {
    for (const c of contracts) log(`${c.status.padEnd(7)} ${c.id.padEnd(22)} ${c.fixtures_passed}/${c.fixtures_total}${c.waiver ? `  waived until ${c.waiver.expires} (${c.waiver.issue})` : ''}`);
    for (const c of contracts) for (const f of c.failures ?? []) log(`  FAIL ${c.id}: ${f}`);
    log(`${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped or waived`);
  }
  const code = exitCode(report, { strict: !!values.strict, implemented }); if (code === 3 && !values.json) log('strict: a client-implemented contract has no fixtures and no waiver'); return code;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) conformance(process.argv.slice(2)).then((c) => process.exit(c));
