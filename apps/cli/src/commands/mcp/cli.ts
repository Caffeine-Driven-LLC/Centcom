/** Real-world wiring for `centcom mcp`. */
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { createAgentBus, createMcpManager, makeWhich, nodeMcpFs } from '@centcom/agent';
import { runMcp } from './index.js';

export async function runMcpCli(argv: string[], root = process.cwd()): Promise<number> {
  const clock = { now: () => Date.now(), setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (h: never) => clearTimeout(h as NodeJS.Timeout) };
  const which = makeWhich();
  // Starting a throw-away engine session to try a server belongs to the engine adapters (C102/C103); until they offer it, a test reports that plainly.
  const testSession = async (): Promise<never> => { throw new Error('test sessions are not available yet'); };
  const mgr = createMcpManager({ fs: nodeMcpFs, home: homedir(), clock, bus: createAgentBus({ onError: () => undefined }), which: (c) => which(c), engines: { testSession } });
  const confirm = async (q: string) => { const rl = createInterface({ input: process.stdin, output: process.stdout }); try { return /^y(es)?$/i.test((await rl.question(`${q} [y/N] `)).trim()); } finally { rl.close(); } };
  try { return await runMcp(argv, { mgr, root, out: (l) => console.log(l), err: (l) => console.error(l), isTTY: !!process.stdin.isTTY && !!process.stdout.isTTY, confirm }); } finally { mgr.dispose(); }
}
