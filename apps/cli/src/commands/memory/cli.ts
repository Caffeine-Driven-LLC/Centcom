/** Real-world wiring for `centcom memory`: the real file system, the person's editor, a real terminal. */
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, readFileSync as read, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { createMemoryFiles, defaultMemoryPaths, nodeMemFs, type MemoryFiles } from '@centcom/agent';
import { runMemory } from './index.js';

/** `.centcom/config.json` `memory.sync: true` turns sync on for a project. Anything unreadable means off. */
export function memorySyncEnabled(root: string): boolean { try { return JSON.parse(readFileSync(join(root, '.centcom', 'config.json'), 'utf8'))?.memory?.sync === true; } catch { return false; } }
export const makeMemoryFiles = (root: string, home = homedir()): MemoryFiles => createMemoryFiles({ fs: nodeMemFs(), engines: defaultMemoryPaths(home), config: { sync: memorySyncEnabled(root) } });

export async function runMemoryCli(argv: string[], root = process.cwd()): Promise<number> {
  const confirm = async (q: string) => { const rl = createInterface({ input: process.stdin, output: process.stdout }); try { return /^y(es)?$/i.test((await rl.question(`${q} [y/N] `)).trim()); } finally { rl.close(); } };
  const edit = async (initial: string) => { const dir = mkdtempSync(join(tmpdir(), 'centcom-mem-')); const file = join(dir, 'memory.md'); writeFileSync(file, initial, { mode: 0o600 }); try { const ed = process.env.VISUAL || process.env.EDITOR || 'vi'; const [cmd, ...args] = ed.split(/\s+/); const code = await new Promise<number | null>((res) => { const c = spawn(cmd!, [...args, file], { stdio: 'inherit', shell: false }); c.once('close', res); c.once('error', () => res(null)); }); return code === 0 ? read(file, 'utf8') : undefined; } finally { rmSync(dir, { recursive: true, force: true }); } };
  return runMemory(argv, { mf: makeMemoryFiles(root), root, out: (l) => console.log(l), err: (l) => console.error(l), isTTY: !!process.stdin.isTTY && !!process.stdout.isTTY, confirm, edit });
}
