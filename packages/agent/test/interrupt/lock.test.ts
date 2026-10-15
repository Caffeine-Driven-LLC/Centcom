import { execFileSync, spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInterruptController, nodeGit, removeStaleIndexLock, type Killed } from '../../src/index.js';

/** Lane C030: the leftover `index.lock` of a stopped turn, against real git repositories. */
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
function repo() { const d = realpathSync(mkdtempSync(join(tmpdir(), 'lock-'))); git(d, 'init', '-q', '-b', 'main'); writeFileSync(join(d, 'a.txt'), 'a'); git(d, 'add', '.'); git(d, 'commit', '-q', '-m', 'one'); return d; }
const lockOf = (d: string) => join(d, '.git', 'index.lock');
const base = (d: string, over: Partial<Parameters<typeof removeStaleIndexLock>[0]> = {}) => ({ git: nodeGit, cwd: d, turnStartedAt: Date.now() - 5000, processesGone: () => true, settleMs: 20, ...over });

describe('a leftover index.lock of the stopped turn', () => {
  it('is removed when it was made during the turn, nothing of ours is still running and it stays unchanged', async () => {
    const d = repo(); writeFileSync(lockOf(d), ''); expect(await removeStaleIndexLock(base(d))).toEqual({ removed: true, reason: 'removed' }); expect(existsSync(lockOf(d))).toBe(false);
    git(d, 'add', '.'); // git works again
  });
  it('is found in a linked worktree too (its own git folder)', async () => {
    const d = repo(); const w = join(d, '..', 'wt-' + Date.now()); git(d, 'worktree', 'add', '-q', '-b', 'side', w); const gitDir = git(w, 'rev-parse', '--absolute-git-dir').trim(); writeFileSync(join(gitDir, 'index.lock'), '');
    expect(await removeStaleIndexLock(base(w))).toEqual({ removed: true, reason: 'removed' }); expect(existsSync(join(gitDir, 'index.lock'))).toBe(false);
  });
  it('is left alone when it is older than the turn (someone else\'s git made it)', async () => {
    const d = repo(); writeFileSync(lockOf(d), ''); const old = new Date(Date.now() - 3_600_000); utimesSync(lockOf(d), old, old);
    expect(await removeStaleIndexLock(base(d))).toEqual({ removed: false, reason: 'older_than_turn' }); expect(existsSync(lockOf(d))).toBe(true);
  });
  it('is left alone while a process we started could still be writing', async () => {
    const d = repo(); writeFileSync(lockOf(d), ''); expect(await removeStaleIndexLock(base(d, { processesGone: () => false }))).toEqual({ removed: false, reason: 'still_running' }); expect(existsSync(lockOf(d))).toBe(true);
    let calls = 0; expect(await removeStaleIndexLock(base(d, { processesGone: () => ++calls < 2 }))).toEqual({ removed: false, reason: 'still_running' }); // it came back during the settle time
  });
  it('is left alone when it changes during the settle time (something is still writing it)', async () => {
    const d = repo(); writeFileSync(lockOf(d), ''); const r = await removeStaleIndexLock(base(d, { settleMs: 50, sleep: async () => { writeFileSync(lockOf(d), 'more'); } }));
    expect(r).toEqual({ removed: false, reason: 'changed' }); expect(existsSync(lockOf(d))).toBe(true);
  });
  it('is left alone while a process of the person still holds it open, even when it was made during the turn and has not changed', async () => {
    const d = repo(); // the person's own `git commit`, started a moment before the interrupt: git creates index.lock with O_EXCL and keeps it open while it works
    const holder = spawn(process.execPath, ['-e', "require('fs').openSync(process.argv[1], 'wx'); console.log('held'); setInterval(() => {}, 1000)", lockOf(d)], { stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      await new Promise<void>((r) => holder.stdout!.once('data', () => r()));
      const r = await removeStaleIndexLock(base(d)); expect(r).toEqual({ removed: false, reason: 'in_use' }); expect(existsSync(lockOf(d))).toBe(true);
    } finally { holder.kill(); }
    await new Promise((r) => holder.once('exit', r)); expect(await removeStaleIndexLock(base(d))).toEqual({ removed: true, reason: 'removed' }); // the holder is gone: now it is a leftover
  });
  it('is left alone when nobody can say whether something holds it', async () => {
    const d = repo(); writeFileSync(lockOf(d), ''); expect(await removeStaleIndexLock(base(d, { holders: async () => 'unsure' }))).toEqual({ removed: false, reason: 'unsure' }); expect(existsSync(lockOf(d))).toBe(true);
    expect(await removeStaleIndexLock(base(d, { holders: async () => 'held' }))).toEqual({ removed: false, reason: 'in_use' });
  });
  it('is left alone when it belongs to another user', async () => {
    const d = repo(); writeFileSync(lockOf(d), ''); const other = { lstat: async (p: string) => { const st = await lstat(p); return { isFile: () => st.isFile(), mtimeMs: st.mtimeMs, size: st.size, uid: (process.getuid?.() ?? 0) + 1 }; }, unlink: async () => { throw new Error('must not be deleted'); } };
    expect(await removeStaleIndexLock(base(d, { fs: other }))).toEqual({ removed: false, reason: 'not_ours' }); expect(existsSync(lockOf(d))).toBe(true);
  });
  it('says none when there is no lock, git_failed outside a repository, and never follows a link or removes a folder', async () => {
    const d = repo(); expect(await removeStaleIndexLock(base(d))).toEqual({ removed: false, reason: 'none' });
    const plain = realpathSync(mkdtempSync(join(tmpdir(), 'nogit-'))); expect((await removeStaleIndexLock(base(plain))).reason).toBe('git_failed');
    mkdirSync(lockOf(d)); expect(await removeStaleIndexLock(base(d))).toEqual({ removed: false, reason: 'not_a_file' }); expect(existsSync(lockOf(d))).toBe(true);
    const e = repo(); const target = join(tmpdir(), 'target-' + Date.now()); writeFileSync(target, 'keep'); symlinkSync(target, lockOf(e)); expect((await removeStaleIndexLock(base(e))).removed).toBe(false); expect(existsSync(target)).toBe(true);
  });
});

describe('the interrupt controller runs the cleanup', () => {
  const target = (killed: Killed[] = []) => ({ busy: () => true, turnId: () => 't1', turnStartedAt: () => 1234, interrupt: async () => ({ stopped: true, method: 'sigint' as const, terminated: killed }) });
  const ctl = (cleanup?: Parameters<typeof createInterruptController>[0]['cleanup'], seen: unknown[] = []) => createInterruptController({ targets: { get: () => target([{ pid: 9, signal: 'SIGINT' }]), busyIds: () => ['a'] }, approvals: { cancel: () => 0 }, states: { interrupted: () => undefined }, emit: (e) => seen.push(e), cleanup });
  it('after the engine is stopped, with the turn start and what was signalled; the result and the event say what it removed', async () => {
    const calls: unknown[] = []; const seen: unknown[] = []; const r = await ctl(async (id, o) => { calls.push([id, o]); return { staleLockRemoved: true }; }, seen).interrupt('a');
    expect(calls).toEqual([['a', { turnStartedAt: 1234, terminated: [{ pid: 9, signal: 'SIGINT' }] }]]); expect(r).toMatchObject({ staleLockRemoved: true }); expect(seen[0]).toMatchObject({ stale_lock_removed: true });
  });
  it('passes the turn start that was known before the engine was stopped (the end of the turn clears it meanwhile)', async () => {
    let started: number | undefined = 1234; const calls: unknown[] = [];
    const t = { busy: () => true, turnId: () => 't1', turnStartedAt: () => started, interrupt: async () => { started = undefined; return { stopped: true, method: 'sigint' as const, terminated: [] as Killed[] }; } };
    const c = createInterruptController({ targets: { get: () => t, busyIds: () => ['a'] }, approvals: { cancel: () => 0 }, states: { interrupted: () => undefined }, emit: () => undefined, cleanup: async (id, o) => { calls.push([id, o.turnStartedAt]); return {}; } });
    await c.interrupt('a'); expect(calls).toEqual([['a', 1234]]);
  });
  it('a cleanup that fails or says nothing does not fail the interrupt', async () => {
    expect(await ctl(async () => { throw new Error('boom'); }).interrupt('a')).toMatchObject({ stoppedStream: true, staleLockRemoved: false }); expect(await ctl().interrupt('a')).toMatchObject({ staleLockRemoved: false });
  });
});
