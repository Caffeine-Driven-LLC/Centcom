/** `centcom doctor [--json] [--bundle <path>] [--check <id>...] [--timeout-ms n]`. Exit 0 all pass, 1 warnings only, 2 any failure. */
import type { CrashStore } from '../crash/index.js';
import { writeBundle } from './bundle.js';
import { ALL_CHECKS } from './checks.js';
import { DEFAULT_TIMEOUT_MS, exitCodeOf, runChecks, type Timers } from './run.js';
import type { DoctorContext } from './types.js';

export interface DoctorIo { out(l: string): void; err(l: string): void }
const MARK = { pass: 'ok  ', warn: 'warn', fail: 'FAIL', skip: 'skip' } as const;
export async function runDoctor(argv: string[], ctx: DoctorContext, io: DoctorIo, extra: { crashes?: CrashStore; timers?: Timers } = {}): Promise<number> {
  const only: string[] = []; let json = false; let bundle: string | undefined; let timeoutMs = DEFAULT_TIMEOUT_MS;
  for (let i = 0; i < argv.length; i++) { const a = argv[i]!; if (a === '--json') json = true; else if (a === '--bundle') bundle = argv[++i]; else if (a === '--check') { const v = argv[++i]; if (v) only.push(v); } else if (a === '--timeout-ms') timeoutMs = Number(argv[++i]); else { io.err('Usage: centcom doctor [--json] [--bundle <path>] [--check <id>...] [--timeout-ms <n>]'); return 2; } }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) { io.err('--timeout-ms must be between 100 and 120000'); return 2; } if (bundle !== undefined && !bundle) { io.err('--bundle needs a file name'); return 2; }
  const known = new Set(ALL_CHECKS.map((c) => c.id)); const bad = only.find((x) => !known.has(x)); if (bad) { io.err(`Unknown check "${bad.slice(0, 30)}". Checks: ${[...known].join(', ')}`); return 2; }
  const report = await runChecks(ctx, { only, timeoutMs, timers: extra.timers });
  if (json) io.out(JSON.stringify(report)); else { io.out(`Centcom ${report.version} (contract ${report.contract})`); for (const c of report.checks) { io.out(`${MARK[c.status]}  ${c.id.padEnd(9)} ${c.summary}`); if (c.next_step) io.out(`      next: ${c.next_step}`); } }
  if (bundle) { try { writeBundle(bundle, [{ name: 'doctor.json', text: JSON.stringify(report, null, 1) }, ...(extra.crashes?.list() ?? []).map((r) => ({ name: `crashes/${r.id}.json`, text: JSON.stringify(r, null, 1) }))]); io.err(`Wrote ${bundle}. Look at it before you share it; nothing was sent.`); } catch { io.err('Could not write the bundle file.'); return 2; } }
  return exitCodeOf(report);
}
