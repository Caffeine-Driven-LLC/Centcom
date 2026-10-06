/** `centcom init [--yes] [--force] [--dry-run]`: the real file system, git and memory files behind `runInit`. */
import { execFileSync } from 'node:child_process';
import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { runInit, type InitDeps } from '@centcom/tui';
import { makeMemoryFiles } from './memory/cli.js';

const exists = (p: string) => access(p).then(() => true, () => false);
const gitOut = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
export function initDeps(cwd: string, io: InitDeps['io']): InitDeps {
  return {
    cwd, io,
    gitRoot: async (c) => { try { return gitOut(c, 'rev-parse', '--show-toplevel'); } catch { return undefined; } },
    excludePath: async (root) => { try { return resolve(root, gitOut(root, 'rev-parse', '--git-path', 'info/exclude')); } catch { return undefined; } },
    config: { exists, write: async (p, t) => { await mkdir(dirname(p), { recursive: true }); await writeFile(p, t, { mode: 0o644 }); }, copy: (a, b) => copyFile(a, b) },
    memory: {
      find: async (root) => { for (const f of ['CLAUDE.md', 'AGENTS.md']) if (await exists(join(root, f))) return join(root, f); return undefined; },
      create: async (root) => { const mf = makeMemoryFiles(root); const plan = await mf.plan({ engine: 'claude-code', scope: 'project', quickAdd: 'Notes for the agents working in this project go here.', root }); await mf.apply(plan, { accepted: true, planHash: plan.planHash }); return join(root, 'CLAUDE.md'); },
    },
  };
}
export async function runInitCli(argv: string[], cwd = process.cwd()): Promise<number> {
  const bad = argv.filter((a) => !['--yes', '-y', '--force', '--dry-run'].includes(a)); if (bad.length) { console.error('Usage: centcom init [--yes] [--force] [--dry-run]'); return 2; }
  const isTTY = !!process.stdin.isTTY && !!process.stdout.isTTY;
  const confirm = async (q: string) => { const rl = createInterface({ input: process.stdin, output: process.stdout }); try { return /^y(es)?$/i.test((await rl.question(`${q} [y/N] `)).trim()); } finally { rl.close(); } };
  const r = await runInit(initDeps(cwd, { out: (l) => console.log(l), err: (l) => console.error(l), isTTY, confirm }), { yes: argv.includes('--yes') || argv.includes('-y'), force: argv.includes('--force'), dryRun: argv.includes('--dry-run') });
  return r.code;
}
