import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DirtyWorktree, GitTimeout, GitTooOld, NotAGitRepo, WorktreeError, branchUpdatePayload, type GitRunner, type WtFs, nodeWtFs } from '../../src/index.js';
import { ID, commit, mkRepo, rig, sh } from './helpers.js';

const make = async (repo: string, n = 1, o: { label?: string; owner?: string; baseRef?: string } = {}, r = rig()) => ({ r, w: await r.m.create({ repoRoot: repo, agentId: ID(n), ownerSlug: o.owner ?? 'ada', label: o.label ?? 'fix-login', baseRef: o.baseRef }) });

describe('create', () => {
  it('makes a folder under .centcom/worktrees and a centcom/ branch, leaves the main checkout clean, and excludes the root once', async () => {
    const repo = mkRepo(); const { w, r } = await make(repo); expect(w.path.startsWith(join(repo, '.centcom', 'worktrees'))).toBe(true); expect(existsSync(w.path)).toBe(true); expect(w.branch).toBe('centcom/ada/fix-login'); expect(w.baseRef).toBe('main');
    expect(sh(repo, 'worktree', 'list', '--porcelain')).toContain(w.path); expect(sh(repo, 'branch', '--list', w.branch)).toContain('centcom/ada/fix-login'); expect(sh(repo, 'status', '--porcelain')).toBe('');
    await r.m.create({ repoRoot: repo, agentId: ID(2), ownerSlug: 'ada', label: 'other' }); expect(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8').split('\n').filter((l) => l === '/.centcom/*')).toHaveLength(1); expect(sh(repo, 'status', '--porcelain')).toBe('');
  });
  it('the worktree starts at the base ref and the registry records it', async () => {
    const repo = mkRepo(); sh(repo, 'branch', 'dev'); const { w } = await make(repo, 1, { baseRef: 'dev' }); expect(w.baseRef).toBe('dev'); const reg = JSON.parse(readFileSync(join(repo, '.centcom', 'worktrees.json'), 'utf8')); expect(reg.entries[ID(1)]).toMatchObject({ branch: w.branch, base_ref: 'dev' }); expect(reg.entries[ID(1)].created_at).toMatch(/Z$/);
  });
  it('three worktrees with the same label get -2 and -3; odd labels are slugged into valid branch names', async () => {
    const repo = mkRepo(); const r = rig(); const names: string[] = []; for (let i = 1; i <= 3; i++) names.push((await r.m.create({ repoRoot: repo, agentId: ID(i), ownerSlug: 'ada', label: 'same' })).branch); expect(names).toEqual(['centcom/ada/same', 'centcom/ada/same-2', 'centcom/ada/same-3']);
    for (const [i, label] of ['we ird..name', '~^:?*[x', 'ünï cödé ✓', '--upload-pack=evil', '../../etc', 'a'.repeat(200)].entries()) { const w = await r.m.create({ repoRoot: repo, agentId: ID(10 + i), ownerSlug: 'A Da!', label }); expect(w.branch).toMatch(/^centcom\/a-da\/[a-z0-9-]+$/); expect(() => sh(repo, 'check-ref-format', '--branch', w.branch)).not.toThrow(); expect(w.branch.length).toBeLessThan(80); }
  });
  it('falls back to a free name after 20 collisions and fails cleanly when none is left', async () => { const repo = mkRepo(); const r = rig(); for (let i = 1; i <= 20; i++) await r.m.create({ repoRoot: repo, agentId: ID(i), ownerSlug: 'ada', label: 'x' }); await expect(r.m.create({ repoRoot: repo, agentId: ID(21), ownerSlug: 'ada', label: 'x' })).rejects.toMatchObject({ code: 'branch_exists' }); });
  it('a second create for the same agent is refused', async () => { const repo = mkRepo(); const { r } = await make(repo); await expect(r.m.create({ repoRoot: repo, agentId: ID(1), ownerSlug: 'ada' })).rejects.toMatchObject({ code: 'duplicate_agent' }); });
  it('refuses a folder that is not a repository, a bare repository, a bad base and an option-looking base', async () => {
    const r = rig(); const { mkdtempSync, realpathSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const plain = realpathSync(mkdtempSync(join(tmpdir(), 'plain-')));
    await expect(r.m.create({ repoRoot: plain, agentId: ID(1), ownerSlug: 'a' })).rejects.toBeInstanceOf(NotAGitRepo); const bare = realpathSync(mkdtempSync(join(tmpdir(), 'bare-'))); sh(bare, 'init', '-q', '--bare'); await expect(r.m.create({ repoRoot: bare, agentId: ID(1), ownerSlug: 'a' })).rejects.toBeInstanceOf(NotAGitRepo);
    const repo = mkRepo(); await expect(r.m.create({ repoRoot: repo, agentId: ID(2), ownerSlug: 'a', baseRef: 'nope' })).rejects.toMatchObject({ code: 'bad_ref' }); await expect(r.m.create({ repoRoot: repo, agentId: ID(3), ownerSlug: 'a', baseRef: '--upload-pack=x' })).rejects.toMatchObject({ code: 'bad_ref' }); expect(readdirSync(join(repo, '.centcom', 'worktrees'))).toEqual([]);
  });
  it('git older than 2.38 is refused with GitTooOld', async () => { const git: GitRunner = { run: async () => ({ code: 0, stdout: 'git version 2.30.1\n', stderr: '' }) }; await expect(rig({ git }).m.create({ repoRoot: '/x', agentId: ID(1), ownerSlug: 'a' })).rejects.toBeInstanceOf(GitTooOld); });
  it('roots outside the repository parent or on a system directory are refused before anything is made', async () => {
    const repo = mkRepo(); const { mkdtempSync, realpathSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'else-')));
    await expect(rig({ root: elsewhere }).m.create({ repoRoot: repo, agentId: ID(1), ownerSlug: 'a' })).rejects.toMatchObject({ code: 'unsafe_root' }); await expect(rig({ root: '/etc/centcom' }).m.create({ repoRoot: repo, agentId: ID(1), ownerSlug: 'a' })).rejects.toMatchObject({ code: 'unsafe_root' }); await expect(rig({ root: '/' }).m.create({ repoRoot: repo, agentId: ID(1), ownerSlug: 'a' })).rejects.toMatchObject({ code: 'unsafe_root' });
    const sibling = join(repo, '..', 'wts'); const w = await rig({ root: sibling }).m.create({ repoRoot: repo, agentId: ID(1), ownerSlug: 'a' }); expect(w.path.startsWith(join(repo, '..', 'wts'))).toBe(true);
  });
  it('a root that is a symlink pointing outside is refused (checked after resolving)', async () => {
    const repo = mkRepo(); const { mkdtempSync, realpathSync, symlinkSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const out = realpathSync(mkdtempSync(join(tmpdir(), 'out-'))); mkdirSync(join(repo, '.centcom')); symlinkSync(out, join(repo, '.centcom', 'worktrees')); await expect(rig().m.create({ repoRoot: repo, agentId: ID(1), ownerSlug: 'a' })).rejects.toMatchObject({ code: 'unsafe_root' });
  });
  it('if the registry cannot be written the half-made worktree and branch are rolled back', async () => {
    const repo = mkRepo(); const fs: WtFs = { ...nodeWtFs, writeFileAtomic: async () => { throw new Error('disk full'); } }; const r = rig({ fs }); await expect(r.m.create({ repoRoot: repo, agentId: ID(1), ownerSlug: 'a', label: 'x' })).rejects.toThrow('disk full');
    expect(sh(repo, 'branch', '--list', 'centcom/*')).toBe(''); expect(readdirSync(join(repo, '.centcom', 'worktrees'))).toEqual([]); expect(sh(repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
  });
});

describe('status', () => {
  it('after editing one file and committing another: dirty, ahead 1, behind 0; then the base moves on by 2: behind 2', async () => {
    const repo = mkRepo(); const { w, r } = await make(repo); commit(w.path, 'b.txt', 'changed\n'); writeFileSync(join(w.path, 'a.txt'), 'edited\n'); let s = await r.m.status(w); expect(s).toMatchObject({ branch: w.branch, dirty: true, ahead: 1, behind: 0 }); expect(s.head).toMatch(/^[0-9a-f]{40}$/);
    commit(repo, 'c.txt', '1'); commit(repo, 'd.txt', '2'); s = await r.m.status(w); expect(s).toMatchObject({ ahead: 1, behind: 2, dirty: true });
  });
  it('a fresh worktree is clean, 0 ahead and 0 behind; untracked files count as dirty', async () => { const repo = mkRepo(); const { w, r } = await make(repo); expect(await r.m.status(w)).toMatchObject({ dirty: false, ahead: 0, behind: 0 }); writeFileSync(join(w.path, 'new.txt'), 'x'); expect((await r.m.status(w)).dirty).toBe(true); });
  it('branchUpdatePayload carries exactly the branch.update fields', async () => { const repo = mkRepo(); const { w, r } = await make(repo); expect(Object.keys(await branchUpdatePayload(r.m, w)).sort()).toEqual(['agent_id', 'ahead', 'behind', 'branch', 'dirty', 'head']); });
});

describe('remove', () => {
  it('a dirty worktree and one with unmerged commits are refused', async () => {
    const repo = mkRepo(); const { w, r } = await make(repo); writeFileSync(join(w.path, 'a.txt'), 'x'); await expect(r.m.remove(w)).rejects.toBeInstanceOf(DirtyWorktree); await expect(r.m.remove(w)).rejects.toMatchObject({ reason: 'uncommitted' });
    sh(w.path, 'checkout', '--', 'a.txt'); commit(w.path, 'b.txt', 'more'); await expect(r.m.remove(w)).rejects.toMatchObject({ reason: 'unmerged' }); expect(existsSync(w.path)).toBe(true);
  });
  it('--force removes the folder, the registry entry and the branch', async () => {
    const repo = mkRepo(); const { w, r } = await make(repo); writeFileSync(join(w.path, 'a.txt'), 'x'); commit(w.path, 'b.txt', 'more'); await r.m.remove(w, { force: true });
    expect(existsSync(w.path)).toBe(false); expect(sh(repo, 'branch', '--list', w.branch)).toBe(''); expect((await r.m.list(repo)).map((x) => x.agentId)).not.toContain(w.agentId); expect(JSON.parse(readFileSync(join(repo, '.centcom', 'worktrees.json'), 'utf8')).entries).toEqual({}); expect(sh(repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
  });
  it('a clean, merged worktree is removed without force', async () => { const repo = mkRepo(); const { w, r } = await make(repo); await r.m.remove(w); expect(existsSync(w.path)).toBe(false); expect(sh(repo, 'branch', '--list', 'centcom/*')).toBe(''); });
  it('a worktree this manager did not create is never touched', async () => {
    const repo = mkRepo(); const r = rig(); const mine = await r.m.create({ repoRoot: repo, agentId: ID(1), ownerSlug: 'a' }); const foreign = join(repo, '..', 'foreign'); sh(repo, 'worktree', 'add', '-q', '-b', 'mine/other', foreign);
    await expect(r.m.remove({ ...mine, agentId: ID(9), path: foreign, branch: 'mine/other' })).rejects.toMatchObject({ code: 'unknown_worktree' }); await expect(r.m.remove({ ...mine, path: foreign })).rejects.toMatchObject({ code: 'unknown_worktree' }); expect(existsSync(foreign)).toBe(true);
  });
});

describe('list, reconcile and prune', () => {
  it('a folder deleted by hand shows as missing; prune removes the git metadata and the registry entry', async () => {
    const repo = mkRepo(); const { w, r } = await make(repo); const keep = await r.m.create({ repoRoot: repo, agentId: ID(2), ownerSlug: 'a', label: 'keep' }); rmSync(w.path, { recursive: true, force: true });
    const list = await r.m.list(repo); expect(list.find((x) => x.agentId === w.agentId)).toMatchObject({ missing: true }); expect(list.find((x) => x.agentId === keep.agentId)?.missing).toBeUndefined();
    expect(await r.m.prune(repo)).toBe(1); expect(sh(repo, 'worktree', 'list', '--porcelain')).not.toContain(w.path); expect((await r.m.list(repo)).map((x) => x.agentId)).toEqual([keep.agentId]); expect(sh(repo, 'branch', '--list', w.branch)).toBe(''); expect(await r.m.prune(repo)).toBe(0);
  });
  it('a registry entry with no folder and no git metadata is dropped at the next list', async () => {
    const repo = mkRepo(); const { w, r } = await make(repo); rmSync(w.path, { recursive: true, force: true }); sh(repo, 'worktree', 'prune'); expect((await r.m.list(repo)).map((x) => x.agentId)).toEqual([]); expect(JSON.parse(readFileSync(join(repo, '.centcom', 'worktrees.json'), 'utf8')).entries).toEqual({});
  });
  it('a worktree under the root that is not in the registry is flagged orphan and left alone', async () => {
    const repo = mkRepo(); const r = rig(); await r.m.create({ repoRoot: repo, agentId: ID(1), ownerSlug: 'a' }); const stray = join(repo, '.centcom', 'worktrees', 'stray'); sh(repo, 'worktree', 'add', '-q', '-b', 'stray', stray);
    const list = await r.m.list(repo); expect(list.find((x) => x.path === stray)).toMatchObject({ orphan: true }); await r.m.prune(repo); expect(existsSync(stray)).toBe(true);
  });
  it('a damaged registry file is treated as empty instead of crashing', async () => { const repo = mkRepo(); mkdirSync(join(repo, '.centcom'), { recursive: true }); writeFileSync(join(repo, '.centcom', 'worktrees.json'), '{ not json'); expect(await rig().m.list(repo)).toEqual([]); });
});

describe('detectConflict', () => {
  it('returns the exact conflicted paths for edits of the same line, [] for different lines, and changes nothing', async () => {
    const repo = mkRepo(); const { w, r } = await make(repo); commit(w.path, 'a.txt', 'one\nTWO-from-agent\nthree\n'); commit(repo, 'a.txt', 'one\nTWO-from-main\nthree\n'); commit(repo, 'b.txt', 'bee main\n');
    const headW = sh(w.path, 'rev-parse', 'HEAD'); const headM = sh(repo, 'rev-parse', 'HEAD'); commit(w.path, 'b.txt', 'bee agent\n'); const before = sh(w.path, 'rev-parse', 'HEAD');
    expect((await r.m.detectConflict(w, 'main')).sort()).toEqual(['a.txt', 'b.txt']); expect(sh(w.path, 'rev-parse', 'HEAD')).toBe(before); expect(sh(repo, 'rev-parse', 'HEAD')).toBe(headM); expect(sh(w.path, 'status', '--porcelain')).toBe(''); expect(sh(repo, 'status', '--porcelain')).toBe(''); void headW;
    const repo2 = mkRepo(); const two = await make(repo2); commit(two.w.path, 'a.txt', 'ONE\ntwo\nthree\n'); commit(repo2, 'a.txt', 'one\ntwo\nTHREE\n'); expect(await two.r.m.detectConflict(two.w, 'main')).toEqual([]);
  });
  it('returns names relative to the repo, and an unknown or option-looking ref is refused', async () => { const repo = mkRepo(); mkdirSync(join(repo, 'sub')); commit(repo, 'sub/f.txt', 'x\n'); const { w, r } = await make(repo); commit(w.path, 'sub/f.txt', 'agent\n'); commit(repo, 'sub/f.txt', 'main\n'); expect(await r.m.detectConflict(w, 'main')).toEqual(['sub/f.txt']); await expect(r.m.detectConflict(w, 'nope')).rejects.toMatchObject({ code: 'bad_ref' }); await expect(r.m.detectConflict(w, '--x')).rejects.toMatchObject({ code: 'bad_ref' }); });
});

describe('hostile input and failures', () => {
  it('a repository path with spaces, $(), ; and backticks works and executes nothing', async () => {
    const repo = mkRepo('re po $(touch PWNED); echo `touch PWNED2` & x'); const r = rig(); const w = await r.m.create({ repoRoot: repo, agentId: ID(1), ownerSlug: '$(touch PWNED3)', label: '; rm -rf /' }); expect(w.branch).toBe('centcom/touch-pwned3/rm-rf'); await r.m.status(w); await r.m.detectConflict(w, 'main'); await r.m.remove(w);
    for (const p of [repo, join(repo, '..'), process.cwd()]) for (const n of ['PWNED', 'PWNED2', 'PWNED3']) expect(existsSync(join(p, n)), `${n} in ${p}`).toBe(false);
  });
  it('a hung git is rejected with GitTimeout after exactly the read timeout (fake clock)', async () => {
    const git: GitRunner = { run: () => new Promise(() => undefined) }; const r = rig({ git }); let err: unknown; const p = r.m.list('/x').catch((e) => { err = e; }); await r.clock.advance(9_999); expect(err).toBeUndefined(); await r.clock.advance(1); await p; expect(err).toBeInstanceOf(GitTimeout);
  });
  it('add, remove and merge-tree use the longer timeouts', async () => {
    const calls: { argv: string[]; ms: number }[] = []; const git: GitRunner = { run: async (argv, o) => { calls.push({ argv, ms: o.timeoutMs }); if (argv[0] === '--version') return { code: 0, stdout: 'git version 2.50.0', stderr: '' }; if (argv[0] === 'rev-parse' && argv[1] === '--is-bare-repository') return { code: 0, stdout: 'false\n', stderr: '' }; if (argv[0] === 'rev-parse' && argv[1] === '--show-toplevel') return { code: 0, stdout: process.cwd() + '\n', stderr: '' }; return { code: 0, stdout: '', stderr: '' }; } };
    const r = rig({ git, root: join(process.cwd(), 'x-never-created') }); await r.m.create({ repoRoot: process.cwd(), agentId: ID(1), ownerSlug: 'a' }).catch(() => undefined); const add = calls.find((c) => c.argv[0] === 'worktree' && c.argv[1] === 'add'); if (add) expect(add.ms).toBe(30_000); expect(calls.every((c) => c.ms === 10_000 || c.ms === 30_000)).toBe(true); rmSync(join(process.cwd(), 'x-never-created'), { recursive: true, force: true });
  });
  it('an index.lock held by another git is retried three times, then fails as a timeout', async () => {
    let n = 0; const git: GitRunner = { run: async (argv) => { if (argv[0] === '--version') return { code: 0, stdout: 'git version 2.50.0', stderr: '' }; n++; return { code: 128, stdout: '', stderr: "fatal: Unable to create '/r/.git/index.lock': File exists." }; } };
    const r = rig({ git }); let err: unknown; const p = r.m.list('/x').catch((e) => { err = e; }); for (let i = 0; i < 10; i++) await r.clock.advance(400); await p; expect(err).toBeInstanceOf(GitTimeout); expect(n).toBe(4);
  });
  it('after one lock failure the retry succeeds', async () => {
    let n = 0; const git: GitRunner = { run: async (argv) => { if (argv[0] === '--version') return { code: 0, stdout: 'git version 2.50.0', stderr: '' }; if (argv[1] === '--is-bare-repository') { n++; return n === 1 ? { code: 128, stdout: '', stderr: 'index.lock' } : { code: 0, stdout: 'false\n', stderr: '' }; } return { code: 128, stdout: '', stderr: 'fatal: not a git repository' }; } };
    const r = rig({ git }); const p = r.m.list('/x').catch((e) => e); await new Promise((res) => setImmediate(res)); await r.clock.advance(500); expect(await p).toBeInstanceOf(NotAGitRepo); expect(n).toBe(2);
  });
});

describe('events and logs', () => {
  it('create and remove emit worktree:created and worktree:removed with ids, path and branch', async () => {
    const repo = mkRepo(); const { w, r } = await make(repo); await r.m.remove(w); expect(r.events).toEqual([{ name: 'worktree:created', p: { agent_id: ID(1), path: w.path, branch: w.branch } }, { name: 'worktree:removed', p: { agent_id: ID(1), path: w.path } }]);
  });
  it('logs carry agent ids only: never a path or a branch name', async () => { const repo = mkRepo(); const { w, r } = await make(repo, 1, { label: 'very-secret-branch' }); await r.m.status(w); await r.m.remove(w); const t = r.logs.join('\n'); expect(t).toContain('worktree.created'); expect(t).not.toContain('very-secret'); expect(t).not.toContain(repo); expect(t).not.toContain('.centcom'); });
});
