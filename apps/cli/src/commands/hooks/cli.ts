/** Real-world wiring for `centcom hooks`. */
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { createHooksManager, makeWhich, nodeHooksFs } from '@centcom/agent';
import { runHooks } from './index.js';

export async function runHooksCli(argv: string[], root = process.cwd()): Promise<number> {
  const clock = { now: () => Date.now(), setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (h: never) => clearTimeout(h as NodeJS.Timeout) }; const which = makeWhich(); const home = homedir();
  const mgr = createHooksManager({ fs: nodeHooksFs, clock, which: (c) => which(c), engines: { capabilities: () => undefined, settingsPaths: (engine, scope, r) => (engine !== 'claude-code' ? undefined : scope === 'user' ? `${home}/.claude/settings.json` : r ? `${r}/.claude/settings${scope === 'local' ? '.local' : ''}.json` : undefined) } });
  const confirm = async (q: string) => { const rl = createInterface({ input: process.stdin, output: process.stdout }); try { return /^y(es)?$/i.test((await rl.question(`${q} [y/N] `)).trim()); } finally { rl.close(); } };
  return runHooks(argv, { mgr, root, out: (l) => console.log(l), err: (l) => console.error(l), isTTY: !!process.stdin.isTTY && !!process.stdout.isTTY, confirm });
}
