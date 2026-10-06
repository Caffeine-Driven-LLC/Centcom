import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { VirtualClock } from '@centcom/testkit';
import { afterAll } from 'vitest';
import { createCheckpointManager, nodeGit, type AgentEngine, type Capability, type CheckpointStore, type EngineSession, type GitRunner } from '../../src/index.js';

const dirs: string[] = []; afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
export const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
export function repo(files: Record<string, string | Buffer> = { 'a.txt': 'a\n', 'src/b.ts': 'b\n', '.gitignore': 'ignored/\n*.log\n' }, o: { git?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'centcom-cp-')); dirs.push(dir); const put = (rel: string, text: string | Buffer) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
  if (o.git !== false) { sh(dir, 'init', '-q', '-b', 'main'); sh(dir, 'config', 'commit.gpgsign', 'false'); }
  for (const [k, v] of Object.entries(files)) put(k, v); if (o.git !== false) { sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'init'); }
  return { dir, put, read: (rel: string) => readFileSync(join(dir, rel), 'utf8'), chmod: (rel: string, m: number) => chmodSync(join(dir, rel), m), link: (target: string, rel: string) => symlinkSync(target, join(dir, rel)) };
}
export function stubEngine(caps: Capability[] = ['resume']) {
  const starts: { resume?: string; sent: string[] }[] = []; let refuse: string | undefined;
  const engine: Pick<AgentEngine, 'capabilities' | 'start'> = { capabilities: () => new Set(caps), async start(o) { if (o.resume && refuse) throw new Error(refuse); const rec = { resume: o.resume?.engine_session_id, sent: [] as string[] }; starts.push(rec); return { agentId: o.agentId, events: (async function* () {})(), send: async (p: string) => { rec.sent.push(p); return { turn_id: 't' }; }, interrupt: async () => ({ stopped: true }), stop: async () => undefined, resumeToken: () => undefined } as EngineSession; } };
  return { engine, starts, refuse: (m: string) => { refuse = m; } };
}
export function stubStore(summary = 'S'.repeat(20)) { const marks: number[] = []; const asked: number[] = []; const store: CheckpointStore = { markRewind: async (n) => { marks.push(n); }, summarize: async (n, max) => { asked.push(max); return typeof summary === 'string' ? summary : ''; } }; return { store, marks, asked }; }
export function rig(r: ReturnType<typeof repo>, o: { caps?: Capability[]; git?: GitRunner; summary?: string; agentId?: string } = {}) {
  const clock = new VirtualClock(); const eng = stubEngine(o.caps); const st = stubStore(o.summary);
  const mgr = createCheckpointManager({ worktree: r.dir, agentId: o.agentId ?? 'agt_01JTEST0000000000000000001', store: st.store, engine: eng.engine, git: o.git ?? nodeGit, clock });
  const turn = async (label: string, seq: number, edit: () => void, ctx: { engineSession?: { id: string } } = {}) => { const c = await mgr.create(label, { promptSeq: seq, ...ctx }); edit(); await mgr.endTurn(); await clock.advance(1000); return c; };
  return { mgr, clock, ...eng, ...st, turn };
}
export const status = (dir: string) => sh(dir, 'status', '--porcelain', '--untracked-files=all');
export const tree = (dir: string) => sh(dir, 'write-tree').trim();
