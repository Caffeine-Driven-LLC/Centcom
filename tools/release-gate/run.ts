/** `pnpm release-gate [--out release-gate-report.json] [--dir release-gate-inputs]`. Reads the report files the other gates wrote, runs the contract-lock check, and exits 0 only if every required check passes. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { evaluate, type Inputs } from './check.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (p: string): unknown => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : undefined; } catch { return undefined; } };
export function gather(dir: string, lockOk: () => boolean): Inputs {
  const j = (n: string) => readJson(join(dir, n)); const cov = j('coverage-summary.json') as { packages?: Record<string, number> } | undefined;
  return { conformance: j('conformance-report.json') as Inputs['conformance'], coverage: cov?.packages, bench: j('bench-report.json') as Inputs['bench'], security: j('security-report.json') as Inputs['security'], artifacts: j('artifacts.json') as Inputs['artifacts'], contractLock: { ok: lockOk() }, docs: j('docs-report.json') as Inputs['docs'], installers: j('installers-report.json') as Inputs['installers'], update: j('update-report.json') as Inputs['update'] };
}
export function main(argv: string[], log: (l: string) => void = console.log): number {
  const { values } = parseArgs({ args: argv, options: { out: { type: 'string' }, dir: { type: 'string' } } });
  const r = evaluate(gather(resolve(values.dir ?? join(root, 'release-gate-inputs')), () => spawnSync('python3', ['tools/plan/lock.py', '--check'], { cwd: root }).status === 0));
  for (const c of r.checks) log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.id.padEnd(14)} ${c.detail}`);
  log(r.passed ? 'Release gate: passed' : 'Release gate: NOT passed');
  if (values.out) writeFileSync(values.out, JSON.stringify({ passed: r.passed, checks: r.checks }, null, 2) + '\n'); return r.passed ? 0 : 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exit(main(process.argv.slice(2)));
