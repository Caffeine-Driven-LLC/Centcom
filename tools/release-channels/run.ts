/** `pnpm release:update-check [--out release-gate-inputs/update-report.json]`: runs every update scenario against the mock release server and writes the report the
 *  release gate reads for its `update` line (`{ ok, scenarios: [{ id, ok, detail? }] }`). Exits 0 only if all pass. Prints ids and statuses only. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runUpdateScenarios } from './scenarios.js';

export async function main(argv: string[], log: (l: string) => void = console.log): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { out: { type: 'string' } } });
  const results = await runUpdateScenarios(); const ok = results.length > 0 && results.every((r) => r.ok);
  for (const r of results) log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id}${r.detail ? `: ${r.detail}` : ''}`);
  if (values.out) { mkdirSync(dirname(resolve(values.out)), { recursive: true }); writeFileSync(values.out, JSON.stringify({ ok, scenarios: results }, null, 2) + '\n'); }
  log(ok ? 'Update path: verified' : 'Update path: NOT verified'); return ok ? 0 : 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exit(await main(process.argv.slice(2)));
