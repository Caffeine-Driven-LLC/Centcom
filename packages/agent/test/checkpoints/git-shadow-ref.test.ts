import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repo, rig, sh, status } from './helpers.js';

const AGT = 'agt_01JTEST0000000000000000001';
describe('shadow refs (acceptance 1 and 2)', () => {
  it('leaves status, HEAD, the real index, stash, branches and reflog untouched, and puts the snapshot under refs/centcom/', async () => {
    const r = repo(); r.put('a.txt', 'changed\n'); r.put('new.txt', 'new\n'); sh(r.dir, 'stash', 'push', '-u', '-q'); r.put('a.txt', 'changed again\n'); r.put('untracked.txt', 'u\n'); r.put('ignored/x', 'i\n'); r.put('debug.log', 'l\n');
    const before = { status: status(r.dir), head: sh(r.dir, 'rev-parse', 'HEAD'), index: readFileSync(join(r.dir, '.git/index')), stash: sh(r.dir, 'stash', 'list'), branches: sh(r.dir, 'for-each-ref', 'refs/heads'), reflog: sh(r.dir, 'reflog', 'show', 'HEAD'), gi: r.read('.gitignore') };
    const t = rig(r); for (let i = 0; i < 10; i++) { await t.mgr.create(`turn ${i}`, { promptSeq: i }); await t.mgr.endTurn(); }
    expect(sh(r.dir, 'rev-parse', `refs/centcom/checkpoints/${AGT}`).trim()).toMatch(/^[0-9a-f]{40}$/); expect(sh(r.dir, 'for-each-ref', `refs/centcom/checkpoints/${AGT}@*`).trim().split('\n').length).toBe(20);
    const after = { status: status(r.dir), head: sh(r.dir, 'rev-parse', 'HEAD'), index: readFileSync(join(r.dir, '.git/index')), stash: sh(r.dir, 'stash', 'list'), branches: sh(r.dir, 'for-each-ref', 'refs/heads'), reflog: sh(r.dir, 'reflog', 'show', 'HEAD'), gi: r.read('.gitignore') };
    expect(after.status).toBe(before.status); expect(after.head).toBe(before.head); expect(after.index.equals(before.index)).toBe(true); expect(after.stash).toBe(before.stash); expect(after.branches).toBe(before.branches); expect(after.reflog).toBe(before.reflog); expect(after.gi).toBe(before.gi);
    expect(readdirSync(join(r.dir, '.git')).filter((f) => f.startsWith('centcom-idx'))).toEqual([]); // the temporary index is gone
    await t.mgr.rewind('ckp_3', 'files'); expect(sh(r.dir, 'for-each-ref', 'refs/heads')).toBe(before.branches); expect(sh(r.dir, 'rev-parse', 'HEAD')).toBe(before.head);
  });
  it('the snapshot holds untracked files and not ignored ones', async () => { const r = repo(); r.put('untracked.txt', 'u\n'); r.put('ignored/x', 'i\n'); r.put('debug.log', 'l\n'); const t = rig(r); const c = await t.mgr.create('x', { promptSeq: 1 }); const files = sh(r.dir, 'ls-tree', '-r', '--name-only', c.commit!).split('\n'); expect(files).toContain('untracked.txt'); expect(files).toContain('a.txt'); expect(files).not.toContain('ignored/x'); expect(files).not.toContain('debug.log'); });
  it('labels are cut to 60 characters and flattened to one line; counts are against the previous checkpoint', async () => {
    const r = repo(); const t = rig(r); const c1 = await t.mgr.create('first line\nsecond line ' + 'x'.repeat(100), { promptSeq: 1 }); expect(c1.label.length).toBe(60); expect(c1.label).not.toContain('\n'); r.put('a.txt', 'changed\n'); r.put('n1', '1'); r.put('n2', '2'); r.chmod('src/b.ts', 0o755);
    const c2 = await t.mgr.create('second', { promptSeq: 2 }); expect(c2.files).toEqual({ changed: 2, added: 2, removed: 0 }); expect(c2.promptSeq).toBe(2);
  });
  it('2,000 tracked files and 5 changes: a checkpoint in under 500 ms', async () => {
    const files: Record<string, string> = { '.gitignore': '' }; for (let i = 0; i < 2000; i++) files[`d${i % 40}/f${i}.txt`] = `file ${i}\n`; const r = repo(files); for (let i = 0; i < 5; i++) r.put(`d${i}/f${i}.txt`, `edited ${i}\n`);
    const t = rig(r); await t.mgr.create('warm', { promptSeq: 0 }); r.put('d6/f6.txt', 'again\n'); const s0 = performance.now(); const c = await t.mgr.create('timed', { promptSeq: 1 }); const ms = performance.now() - s0; expect(c.commit).toMatch(/^[0-9a-f]{40}$/); expect(ms).toBeLessThan(500);
  }, 60_000);
  it('survives a restart: checkpoints are read back from the refs', async () => { const r = repo(); const t = rig(r); await t.turn('one', 1, () => r.put('a.txt', '1\n'), { engineSession: { id: 'eng-1' } }); await t.turn('two', 2, () => r.put('a.txt', '2\n')); const t2 = rig(r); await t2.mgr.ready(); expect(t2.mgr.list().map((c) => [c.n, c.label, c.promptSeq, c.engineSession?.id])).toEqual([[1, 'one', 1, 'eng-1'], [2, 'two', 2, undefined]]); const c3 = await t2.mgr.create('three', { promptSeq: 3 }); expect(c3.n).toBe(3); });
  it('a hostile ref-looking label or prompt text cannot change what git does', async () => { const r = repo(); const t = rig(r); const c = await t.mgr.create('--amend -m x; rm -rf / $(touch pwned)', { promptSeq: 1 }); expect(c.commit).not.toBeNull(); expect(() => readFileSync(join(r.dir, 'pwned'))).toThrow(); });
});
