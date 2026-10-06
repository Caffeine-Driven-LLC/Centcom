import { VirtualClock } from '@centcom/testkit';
import { createProviderDetector, type DetectDeps, type RunFn, type RunResult } from '../../src/index.js';

export const res = (out = '', code: number | null = 0, o: Partial<RunResult> = {}): RunResult => ({ code, out, missing: false, timedOut: false, tooLong: false, ...o });
/** A fake `run`: keys are the argument lists joined by a space. Unlisted probes behave like a missing subcommand (exit 1). Every call is recorded. */
export function fakeRun(table: Record<string, RunResult | (() => Promise<RunResult>)>) {
  const calls: string[] = []; const run: RunFn = async (f, args) => { const k = args.join(' '); calls.push(k); const v = table[k] ?? table[`${f.split('/').pop()}:${k}`]; return v === undefined ? res('', 1) : typeof v === 'function' ? v() : v; };
  return { run, calls };
}
export const CLAUDE_OK = { 'claude:--version': res('2.1.0 (Claude Code)\n'), 'claude:auth --help': res('usage'), 'claude:auth status': res(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })) };
export const CODEX_OK = { 'codex:--version': res('codex-cli 0.55.0\n'), 'codex:login status': res('Logged in using ChatGPT\n') };
export function rig(table: Record<string, RunResult | (() => Promise<RunResult>)>, o: { installed?: string[]; env?: Record<string, string> } = {}) {
  const clock = new VirtualClock(); const f = fakeRun(table); const installed = o.installed ?? ['claude', 'codex'];
  const deps: DetectDeps = { run: f.run, which: (n) => (installed.includes(n) ? `/usr/bin/${n}` : undefined), clock, env: o.env ?? {} };
  return { clock, calls: f.calls, deps, detector: createProviderDetector(deps) };
}
