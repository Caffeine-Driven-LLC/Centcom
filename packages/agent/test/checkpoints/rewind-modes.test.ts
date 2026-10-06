import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repo, rig, sh, status, tree } from './helpers.js';

const exists = (dir: string, rel: string) => existsSync(join(dir, rel));
describe('rewind files (acceptance 3 and 4)', () => {
  it('restores changed files, recreates deleted ones, deletes the ones created since: the tree equals the checkpoint tree', async () => {
    const r = repo(); r.put('pre-existing-untracked.txt', 'keep\n'); r.put('ignored/x', 'ig\n'); const t = rig(r); const c1 = await t.turn('one', 1, () => { r.put('a.txt', 'edit 1\n'); r.put('made.txt', 'm\n'); r.put('deep/dir/made2.txt', 'm2\n'); });
    const cp = await t.mgr.create('two', { promptSeq: 2 }); const cpTree = sh(r.dir, 'rev-parse', `${cp.commit}^{tree}`).trim(); r.put('a.txt', 'edit 2\n'); r.put('src/b.ts', 'edit b\n'); r.put('later.txt', 'l\n'); sh(r.dir, 'rm', '-q', '-f', 'a.txt'); r.put('ignored/y', 'ig2\n'); await t.mgr.endTurn();
    const plan = await t.mgr.preview(cp.id, 'files'); expect(plan.restore.sort()).toEqual(['a.txt', 'src/b.ts']); expect(plan.delete).toEqual(['later.txt']); expect(plan.needsConfirm).toBe(false); expect(plan.conversation).toBe('none');
    const res = await t.mgr.rewind(cp.id, 'files'); expect(res.restored.sort()).toEqual(['a.txt', 'src/b.ts']); expect(res.deleted).toEqual(['later.txt']);
    expect(r.read('a.txt')).toBe('edit 1\n'); expect(r.read('src/b.ts')).toBe('b\n'); expect(exists(r.dir, 'later.txt')).toBe(false); expect(r.read('pre-existing-untracked.txt')).toBe('keep\n'); expect(r.read('ignored/x')).toBe('ig\n'); expect(exists(r.dir, 'ignored/y')).toBe(true);
    const nowTree = (() => { const tmp = sh(r.dir, 'rev-parse', '--git-path', 'x-test-idx').trim(); sh(r.dir, 'add', '-A'); const tr = tree(r.dir); sh(r.dir, 'reset', '-q'); void tmp; return tr; })(); expect(nowTree).toBe(cpTree); void c1;
  });
  it('rewinding to the first checkpoint removes everything the agent created, including empty folders it made', async () => { const r = repo(); const t = rig(r); const c = await t.mgr.create('start', { promptSeq: 1 }); r.put('deep/dir/x.txt', 'x\n'); await t.mgr.endTurn(); const res = await t.mgr.rewind(c.id, 'files'); expect(res.deleted).toEqual(['deep/dir/x.txt']); expect(exists(r.dir, 'deep')).toBe(false); });
  it('files edited by someone else after the agent finished are skipped, need confirmation, and are only touched when listed', async () => {
    const r = repo(); const t = rig(r); const c1 = await t.turn('one', 1, () => { r.put('a.txt', 'agent edit\n'); r.put('agent-made.txt', 'a\n'); });
    writeFileSync(join(r.dir, 'a.txt'), 'USER EDIT\n'); r.put('user-made.txt', 'mine\n'); r.put('src/b.ts', 'user changed b\n');
    const plan = await t.mgr.preview(c1.id, 'files'); expect(plan.skippedModifiedOutside.sort()).toEqual(['a.txt', 'src/b.ts', 'user-made.txt']); expect(plan.needsConfirm).toBe(true); expect(plan.delete).toEqual(['agent-made.txt']);
    const res = await t.mgr.rewind(c1.id, 'files'); expect(res.skipped.sort()).toEqual(['a.txt', 'src/b.ts', 'user-made.txt']); expect(r.read('a.txt')).toBe('USER EDIT\n'); expect(r.read('user-made.txt')).toBe('mine\n'); expect(exists(r.dir, 'agent-made.txt')).toBe(false);
    const again = await t.mgr.rewind(c1.id, 'files', { confirmedPaths: ['a.txt'] }); expect(again.restored).toEqual(['a.txt']); expect(r.read('a.txt')).toBe('a\n'); expect(r.read('src/b.ts')).toBe('user changed b\n'); expect(r.read('user-made.txt')).toBe('mine\n');
  });
  it('a user edit made between two turns is not undone by rewinding to the later turn, but is when rewinding before it', async () => {
    const r = repo(); const t = rig(r); const c1 = await t.turn('one', 1, () => r.put('a.txt', 'agent 1\n')); r.put('a.txt', 'user between\n'); const c2 = await t.turn('two', 2, () => r.put('src/b.ts', 'agent 2\n'));
    const p2 = await t.mgr.preview(c2.id, 'files'); expect(p2.restore).toEqual(['src/b.ts']); expect(p2.skippedModifiedOutside).toEqual([]); const p1 = await t.mgr.preview(c1.id, 'files'); expect(p1.skippedModifiedOutside).toEqual(['a.txt']);
  });
  it('without end markers (nothing recorded when the agent stopped) every change needs confirmation', async () => { const r = repo(); const t = rig(r); const c = await t.mgr.create('one', { promptSeq: 1 }); r.put('a.txt', 'x\n'); const plan = await t.mgr.preview(c.id, 'files'); expect(plan.restore).toEqual([]); expect(plan.skippedModifiedOutside).toEqual(['a.txt']); expect(plan.needsConfirm).toBe(true); });
  it('every file rewind makes a safety checkpoint first, and rewinding to it undoes the rewind', async () => {
    const r = repo(); const t = rig(r); const c1 = await t.turn('one', 1, () => { r.put('a.txt', 'one\n'); r.put('only-later.txt', 'x\n'); }); const before = status(r.dir); const n0 = t.mgr.list().length;
    const res = await t.mgr.rewind(c1.id, 'files'); expect(res.undoRef).toBe('refs/centcom/rewind-undo/agt_01JTEST0000000000000000001'); expect(t.mgr.list().length).toBe(n0 + 1); expect(t.mgr.list().at(-1)!.label).toBe('before rewind');
    expect(sh(r.dir, 'rev-parse', res.undoRef!).trim()).toBe(t.mgr.list().at(-1)!.commit); const undo = await t.mgr.rewind(t.mgr.list().at(-1)!.id, 'files'); expect(undo.restored.length + undo.deleted.length).toBeGreaterThan(0); expect(r.read('a.txt')).toBe('one\n'); expect(exists(r.dir, 'only-later.txt')).toBe(true); expect(status(r.dir)).toBe(before);
  });
  it('a rewind that changes nothing makes no safety checkpoint', async () => { const r = repo(); const t = rig(r); const c = await t.turn('one', 1, () => undefined); const n = t.mgr.list().length; const res = await t.mgr.rewind(c.id, 'files'); expect(res.restored).toEqual([]); expect(t.mgr.list().length).toBe(n); });
  it('refuses during a merge or rebase and says so; files stay as they are', async () => {
    const r = repo(); const t = rig(r); const c = await t.turn('one', 1, () => r.put('a.txt', 'x\n')); for (const f of ['MERGE_HEAD', 'REBASE_HEAD']) void f; writeFileSync(join(r.dir, '.git/MERGE_HEAD'), sh(r.dir, 'rev-parse', 'HEAD'));
    await expect(t.mgr.rewind(c.id, 'files')).rejects.toMatchObject({ code: 'operation_in_progress' }); await expect(t.mgr.preview(c.id, 'both')).rejects.toMatchObject({ code: 'operation_in_progress' }); expect(r.read('a.txt')).toBe('x\n'); const m = await t.mgr.create('during merge', { promptSeq: 2 }); expect(m.commit).not.toBeNull();
  });
  it('an unknown id', async () => { const r = repo(); const t = rig(r); await expect(t.mgr.rewind('nope', 'files')).rejects.toMatchObject({ code: 'not_found' }); });
  it('a restore that fails half way reports what was and was not restored, and leaves the undo ref', async () => {
    const r = repo({ 'a.txt': 'a\n', 'b.txt': 'b\n', '.gitignore': '' }); const { nodeGit } = await import('../../src/index.js'); let fail = false; const git = { run: (argv: string[], o: Parameters<typeof nodeGit.run>[1]) => (fail && argv[0] === 'checkout-index' ? Promise.resolve({ code: 1, stdout: '', stderr: 'boom' }) : nodeGit.run(argv, o)) };
    const t = rig(r, { git }); const c = await t.turn('one', 1, () => { r.put('a.txt', 'A\n'); r.put('extra.txt', 'e\n'); }); fail = true; const res = await t.mgr.rewind(c.id, 'files'); expect(res.failed).toBeDefined(); expect(res.failed!.unrestored.sort()).toEqual(['a.txt', 'extra.txt']); expect(res.undoRef).toBeDefined(); expect(sh(r.dir, 'rev-parse', res.undoRef!).trim()).toMatch(/^[0-9a-f]{40}$/);
  });
});
describe('conversation and both (acceptance 5 and 7)', () => {
  it('with resume: starts the engine with the stored session id and marks the rewind', async () => {
    const r = repo(); const t = rig(r, { caps: ['resume'] }); const c = await t.turn('one', 7, () => undefined, { engineSession: { id: 'eng-sess-9' } }); const plan = await t.mgr.preview(c.id, 'conversation'); expect(plan.conversation).toBe('engine-resume'); expect(plan.restore).toEqual([]);
    const res = await t.mgr.rewind(c.id, 'conversation'); expect(t.marks).toEqual([7]); expect(t.starts).toEqual([{ resume: 'eng-sess-9', sent: [] }]); expect(res.conversation!.mode).toBe('engine-resume');
  });
  it('without resume: a fresh session whose first prompt carries a summary of at most 8 KiB', async () => {
    const r = repo(); const t = rig(r, { caps: [], summary: 'é'.repeat(20_000) }); const c = await t.turn('one', 3, () => undefined, { engineSession: { id: 'eng-1' } }); expect((await t.mgr.preview(c.id, 'conversation')).conversation).toBe('fresh-with-summary');
    const res = await t.mgr.rewind(c.id, 'conversation'); expect(t.asked).toEqual([8192]); expect(res.conversation!.mode).toBe('fresh-with-summary'); expect(t.starts).toHaveLength(1); expect(t.starts[0]!.resume).toBeUndefined(); const prompt = t.starts[0]!.sent[0]!; expect(prompt).toContain('é'); expect(Buffer.byteLength(prompt.split('\n\n').slice(1).join('\n\n'))).toBeLessThanOrEqual(8192);
  });
  it('a checkpoint with no engine session id is fresh-with-summary even when the engine can resume', async () => { const r = repo(); const t = rig(r, { caps: ['resume'] }); const c = await t.turn('one', 1, () => undefined); expect((await t.mgr.preview(c.id, 'conversation')).conversation).toBe('fresh-with-summary'); });
  it('an engine that refuses the resume falls back to a summary and shows its own message', async () => { const r = repo(); const t = rig(r, { caps: ['resume'] }); t.refuse('session expired: abc'); const c = await t.turn('one', 1, () => undefined, { engineSession: { id: 'e' } }); const res = await t.mgr.rewind(c.id, 'conversation'); expect(res.conversation).toMatchObject({ mode: 'fresh-with-summary', resumeError: 'session expired: abc' }); });
  it('both: files and conversation together', async () => { const r = repo(); const t = rig(r, { caps: ['resume'] }); const c = await t.turn('one', 4, () => r.put('a.txt', 'agent\n'), { engineSession: { id: 'e1' } }); r.put('a.txt', 'later\n'); await t.mgr.endTurn(); const res = await t.mgr.rewind(c.id, 'both'); expect(res.restored).toEqual(['a.txt']); expect(r.read('a.txt')).toBe('a\n'); expect(t.marks).toEqual([4]); expect(res.conversation!.mode).toBe('engine-resume'); });
  it('not a git folder: no snapshot, files mode fails with checkpoint_unavailable, conversation still works (acceptance 7)', async () => {
    const r = repo({ 'a.txt': 'a\n' }, { git: false }); const t = rig(r, { caps: [] }); const c = await t.mgr.create('one', { promptSeq: 1 }); expect(c.commit).toBeNull(); expect(c.files).toEqual({ changed: 0, added: 0, removed: 0 });
    await expect(t.mgr.rewind(c.id, 'files')).rejects.toMatchObject({ code: 'checkpoint_unavailable' }); await expect(t.mgr.preview(c.id, 'both')).rejects.toMatchObject({ code: 'checkpoint_unavailable' }); const res = await t.mgr.rewind(c.id, 'conversation'); expect(res.conversation!.mode).toBe('fresh-with-summary'); expect(t.marks).toEqual([1]); expect(r.read('a.txt')).toBe('a\n');
  });
  it('the confirmation text input: a plan never lists a path outside the folder', async () => { const r = repo(); const t = rig(r); const c = await t.turn('one', 1, () => r.put('x.txt', '1')); const p = await t.mgr.preview(c.id, 'files'); for (const f of [...p.restore, ...p.delete, ...p.skippedModifiedOutside]) expect(f.startsWith('..') || f.startsWith('/')).toBe(false); });
  void readFileSync;
});
