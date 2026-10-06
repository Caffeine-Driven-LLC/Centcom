import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VirtualClock } from '@centcom/testkit';
import { createAgentBus, createWorktreeManager, nodeGit, nodeWtFs, type AgentEventMap, type GitRunner, type WtFs } from '../../src/index.js';

export const ID = (n: number) => `agt_01JTEST00000000000000000${String(n).padStart(2, '0')}` as `agt_${string}`;
export const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
export function mkRepo(name = 'repo'): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'wt-'))); const dir = join(base, name); sh(base, 'init', '-q', '-b', 'main', '--', name);
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n'); writeFileSync(join(dir, 'b.txt'), 'bee\n'); sh(dir, 'add', '.'); sh(dir, 'commit', '-q', '-m', 'init'); return dir;
}
export const commit = (cwd: string, file: string, text: string, msg = 'change') => { writeFileSync(join(cwd, file), text); sh(cwd, 'add', file); sh(cwd, 'commit', '-q', '-m', msg); };
export function rig(o: { git?: GitRunner; fs?: WtFs; root?: string } = {}) {
  const clock = new VirtualClock(); const bus = createAgentBus({ onError: (e) => { throw e; } }); const events: { name: string; p: unknown }[] = [];
  for (const n of ['worktree:created', 'worktree:removed'] as (keyof AgentEventMap)[]) bus.on(n, (p) => events.push({ name: n, p }));
  const logs: string[] = []; const log = { debug: (m: string, c?: object) => logs.push(m + JSON.stringify(c ?? {})), info: (m: string, c?: object) => logs.push(m + JSON.stringify(c ?? {})), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) };
  const m = createWorktreeManager({ git: o.git ?? nodeGit, fs: o.fs ?? nodeWtFs, bus, clock, log, config: { root: o.root }, random: () => 0 });
  return { m, clock, events, logs };
}
