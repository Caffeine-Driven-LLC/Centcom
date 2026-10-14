/** `centcom doctor [--json] [--bundle <path>] [--check <id>...] [--timeout-ms n]`. Exit 0 all pass, 1 warnings only, 2 any failure. */
import type { CrashStore } from '../crash/index.js';
import { redact } from '@centcom/protocol';
import { writeBundle } from './bundle.js';
import { ALL_CHECKS } from './checks.js';
import { DEFAULT_TIMEOUT_MS, exitCodeOf, runChecks, type Timers } from './run.js';
import type { DoctorContext } from './types.js';

export interface DoctorIo { out(l: string): void; err(l: string): void }
const MARK = { pass: 'ok  ', warn: 'warn', fail: 'FAIL', skip: 'skip' } as const;
export const LOG_TAIL_LINES = 500; export const LOG_TAIL_BYTES = 256 * 1024;
/** The last lines of the app log for the bundle. The logger already scrubbed them when it wrote them; they go through the redactor again here, and the home folder is shortened, because the bundle is meant to be shared. */
export function logTail(ctx: DoctorContext): { name: string; text: string } | undefined {
  const f = ctx.readFile(`${ctx.stateDir}/logs/centcom.log`); if (!f) return undefined;
  const lines = f.text.split('\n').filter(Boolean).slice(-LOG_TAIL_LINES).map((l) => redact(ctx.home ? l.split(ctx.home).join('~') : l)); let text = lines.join('\n') + (lines.length ? '\n' : '');
  if (text.length > LOG_TAIL_BYTES) text = text.slice(text.length - LOG_TAIL_BYTES).replace(/^[^\n]*\n/, ''); return lines.length ? { name: 'log-tail.jsonl', text } : undefined;
}
export async function runDoctor(argv: string[], ctx: DoctorContext, io: DoctorIo, extra: { crashes?: CrashStore; timers?: Timers } = {}): Promise<number> {
  const only: string[] = []; let json = false; let bundle: string | undefined; let timeoutMs = DEFAULT_TIMEOUT_MS;
  for (let i = 0; i < argv.length; i++) { const a = argv[i]!; if (a === '--json') json = true; else if (a === '--bundle') bundle = argv[++i]; else if (a === '--check') { const v = argv[++i]; if (v) only.push(v); } else if (a === '--timeout-ms') timeoutMs = Number(argv[++i]); else { io.err('Usage: centcom doctor [--json] [--bundle <path>] [--check <id>...] [--timeout-ms <n>]'); return 2; } }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) { io.err('--timeout-ms must be between 100 and 120000'); return 2; } if (bundle !== undefined && !bundle) { io.err('--bundle needs a file name'); return 2; }
  const known = new Set(ALL_CHECKS.map((c) => c.id)); const bad = only.find((x) => !known.has(x)); if (bad) { io.err(`Unknown check "${bad.slice(0, 30)}". Checks: ${[...known].join(', ')}`); return 2; }
  const report = await runChecks(ctx, { only, timeoutMs, timers: extra.timers });
  if (json) io.out(JSON.stringify(report)); else { io.out(`Centcom ${report.version} (contract ${report.contract})`); for (const c of report.checks) { io.out(`${MARK[c.status]}  ${c.id.padEnd(9)} ${c.summary}`); if (c.next_step) io.out(`      next: ${c.next_step}`); } }
  if (bundle) { try { writeBundle(bundle, [{ name: 'doctor.json', text: JSON.stringify(report, null, 1) }, ...(logTail(ctx) ? [logTail(ctx)!] : []), ...(extra.crashes?.list() ?? []).map((r) => ({ name: `crashes/${r.id}.json`, text: JSON.stringify(r, null, 1) }))]); io.err(`Wrote ${bundle}. Look at it before you share it; nothing was sent.`); } catch { io.err('Could not write the bundle file.'); return 2; } }
  return exitCodeOf(report);
}
