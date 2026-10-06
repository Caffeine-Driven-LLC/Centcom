import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createCheckpointManager, nodeGit, type EngineSession } from '@centcom/agent';
import { age, runRewind, REWIND_NOTICE, type RewindIO } from '../src/commands/rewind.js';

const dirs: string[] = []; afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
function setup(o: Partial<RewindIO> & { yes?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'centcom-rw-')); dirs.push(dir); sh(dir, 'init', '-q', '-b', 'main'); writeFileSync(join(dir, 'a.txt'), 'a\n'); sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'i'); let t = Date.UTC(2026, 9, 6);
  const mgr = createCheckpointManager({ worktree: dir, agentId: 'agt_01JTEST0000000000000000001', store: { markRewind: async () => undefined, summarize: async () => 's' }, engine: { capabilities: () => new Set(), start: async () => ({ send: async () => ({ turn_id: 't' }) }) as unknown as EngineSession }, git: nodeGit, clock: { now: () => (t += 1000), setTimeout: () => 0, clearTimeout: () => undefined } });
  const out: string[] = []; const err: string[] = []; const asked: string[] = [];
  const io: RewindIO = { mgr, now: () => t, out: (l) => out.push(l), err: (l) => err.push(l), isTTY: true, confirm: async (q) => { asked.push(q); return o.yes ?? true; }, ...o };
  return { dir, mgr, io, out, err, asked };
}
describe('rewind command', () => {
  it('lists newest first, with ages and file counts', async () => { const s = setup(); await runRewind(['list'], s.io); expect(s.out).toEqual(['No checkpoints yet. One is made at the start of every turn.']); await s.mgr.create('add the login page', { promptSeq: 1 }); writeFileSync(join(s.dir, 'b.txt'), 'b'); await s.mgr.endTurn(); await s.mgr.create('second', { promptSeq: 2 }); s.out.length = 0; await runRewind([], s.io); expect(s.out[0]).toContain('second'); expect(s.out[0]).toContain('+1 ~0 -0'); expect(s.out[1]).toContain('add the login page'); });
  it('shows the plan and the not-undone notice, asks, and puts files back', async () => { const s = setup(); await s.mgr.create('one', { promptSeq: 1 }); writeFileSync(join(s.dir, 'a.txt'), 'agent\n'); writeFileSync(join(s.dir, 'new.txt'), 'n'); await s.mgr.endTurn(); expect(await runRewind(['1'], s.io)).toBe(0); expect(s.out.join('\n')).toContain('Restore 1 file: a.txt'); expect(s.out.join('\n')).toContain('Delete 1 file created since: new.txt'); expect(s.out).toContain(REWIND_NOTICE); expect(s.asked).toHaveLength(1); expect(readFileSync(join(s.dir, 'a.txt'), 'utf8')).toBe('a\n'); expect(s.out.at(-1)).toContain('Undo: rewind to the "before rewind" checkpoint'); });
  it('a no, or no terminal without --yes, changes nothing', async () => { const s = setup({ yes: false }); await s.mgr.create('one', { promptSeq: 1 }); writeFileSync(join(s.dir, 'a.txt'), 'agent\n'); await s.mgr.endTurn(); expect(await runRewind(['1'], s.io)).toBe(1); expect(readFileSync(join(s.dir, 'a.txt'), 'utf8')).toBe('agent\n'); const nt = setup({ isTTY: false }); await nt.mgr.create('one', { promptSeq: 1 }); expect(await runRewind(['1'], nt.io)).toBe(1); });
  it('files changed by someone else are listed and only touched with --also', async () => { const s = setup(); await s.mgr.create('one', { promptSeq: 1 }); await s.mgr.endTurn(); writeFileSync(join(s.dir, 'a.txt'), 'mine\n'); await runRewind(['1', '--yes'], s.io); expect(s.out.join('\n')).toContain('left alone unless you list them with --also: a.txt'); expect(readFileSync(join(s.dir, 'a.txt'), 'utf8')).toBe('mine\n'); expect(await runRewind(['1', '--yes', '--also', 'a.txt'], s.io)).toBe(0); expect(readFileSync(join(s.dir, 'a.txt'), 'utf8')).toBe('a\n'); });
  it('usage errors and unknown checkpoints', async () => { const s = setup(); expect(await runRewind(['x'], s.io)).toBe(2); expect(await runRewind(['1', '--mode', 'bogus'], s.io)).toBe(2); expect(await runRewind(['5', '--yes'], s.io)).toBe(2); expect(s.err.at(-1)).toContain('no such checkpoint'); });
  it('ages', () => { const n = Date.parse('2026-10-06T12:00:00Z'); expect([age('2026-10-06T11:59:30Z', n), age('2026-10-06T11:50:00Z', n), age('2026-10-06T09:00:00Z', n), age('2026-10-04T12:00:00Z', n)]).toEqual(['30s', '10m', '3h', '2d']); });
});
