/** The real-world wiring of `centcom provider ...`: real processes, real terminal, real clock. The logic lives in index.ts and is tested with fakes. */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { createProviderDetector, makeWhich, runProbe } from '@centcom/agent';
import { runProvider } from './index.js';

export async function runProviderCli(argv: string[]): Promise<number> {
  const clock = { now: () => Date.now(), setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (h: never) => clearTimeout(h as NodeJS.Timeout) };
  let policyCheckedAt: string | undefined;
  try { policyCheckedAt = JSON.parse(readFileSync(new URL('../../../../../contracts/fixtures/providers/policy-reference.json', import.meta.url), 'utf8')).data.checked_at; } catch { /* a packaged build carries its own copy */ }
  const confirm = async (q: string) => { const rl = createInterface({ input: process.stdin, output: process.stdout }); try { return /^y(es)?$/i.test((await rl.question(`${q} [y/N] `)).trim()); } finally { rl.close(); } };
  return runProvider(argv, {
    detector: createProviderDetector({ run: runProbe, which: makeWhich(), clock }), spawn: (f, a, o) => spawn(f, a, o), isTTY: !!process.stdin.isTTY && !!process.stdout.isTTY,
    out: (l) => console.log(l), err: (l) => console.error(l), now: () => Date.now(), os: process.platform, logDir: join(process.env.CENTCOM_HOME ?? join(homedir(), '.centcom'), 'logs'), policyCheckedAt, confirm,
  });
}
