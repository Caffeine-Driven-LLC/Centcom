import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { LOCK_FILE, LOCK_STALE_MS, RefreshLockTimeoutError, acquireRefreshLock, withRefreshLock } from '../../src/index.js';

const dirs: string[] = []; afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'centcom-lock-')); dirs.push(d); return d; };
const child = fileURLToPath(new URL('./fixtures/lock-child.ts', import.meta.url));
const run = (dir: string, log: string, hold: number) => new Promise<number>((resolve, reject) => {
  const p = spawn(process.execPath, ['--import', 'tsx', child, dir, log, String(hold)], { stdio: ['ignore', 'ignore', 'pipe'] }); let err = '';
  p.stderr.on('data', (d) => { err += String(d); }); p.on('error', reject); p.on('exit', (c) => (c === 0 ? resolve(0) : reject(new Error(`child exited ${c}: ${err}`))));
});
/** A lock file left by a holder that crashed `ageMs` ago. */
const staleLock = (dir: string, ageMs: number) => { mkdirSync(dir, { recursive: true }); const f = join(dir, LOCK_FILE); writeFileSync(f, JSON.stringify({ pid: 999999, owner: 'crashed' })); const t = new Date(Date.now() - ageMs); utimesSync(f, t, t); return f; };

describe('two processes racing on a stale lock', () => {
  it('both get the lock in turn (never at the same time), the stale lock is taken over, and nothing deadlocks', async () => {
    const dir = tmp(); const log = join(dir, 'log.txt'); writeFileSync(log, ''); staleLock(dir, LOCK_STALE_MS + 5_000);
    const started = Date.now(); await Promise.all([run(dir, log, 300), run(dir, log, 300)]);
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]!.split(' ')[0]).toBe('enter'); expect(lines[1]).toBe(lines[0]!.replace('enter', 'exit')); expect(lines[2]!.split(' ')[0]).toBe('enter'); expect(lines[3]).toBe(lines[2]!.replace('enter', 'exit'));
    expect(lines[0]).not.toBe(lines[2]); expect(existsSync(join(dir, LOCK_FILE))).toBe(false); expect(Date.now() - started).toBeLessThan(20_000);
  }, 30_000);
});

describe('staleness and release', () => {
  it('a lock is honoured for 10 s and taken over after (clock moved, no real waiting)', async () => {
    const dir = tmp(); staleLock(dir, 0);
    await expect(acquireRefreshLock(dir, { now: () => Date.now() + 9_000, acquireTimeoutMs: 50, sleep: async () => undefined })).rejects.toBeInstanceOf(RefreshLockTimeoutError);
    const h = await acquireRefreshLock(dir, { now: () => Date.now() + 10_500, acquireTimeoutMs: 50 });
    expect(JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8'))).toMatchObject({ pid: process.pid }); await h.release(); expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
  });
  it('a live holder keeps its lock fresh with a heartbeat, so it never looks stale', async () => {
    const dir = tmp(); const h = await acquireRefreshLock(dir, { heartbeatMs: 10 }); const f = join(dir, LOCK_FILE);
    const t = new Date(Date.now() - 60_000); utimesSync(f, t, t); await new Promise((r) => setTimeout(r, 60));
    expect(Date.now() - statSync(f).mtimeMs).toBeLessThan(LOCK_STALE_MS); await h.release();
  });
  it('withRefreshLock releases when the work throws, and the next taker gets it at once', async () => {
    const dir = tmp();
    await expect(withRefreshLock(dir, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false); expect(await withRefreshLock(dir, async () => 7, { acquireTimeoutMs: 100 })).toBe(7);
  });
  it('a waiter gets the lock as soon as the holder releases', async () => {
    const dir = tmp(); const h = await acquireRefreshLock(dir); const order: string[] = [];
    const waiter = withRefreshLock(dir, async () => { order.push('waiter'); }); await new Promise((r) => setTimeout(r, 50)); order.push('release'); await h.release(); await waiter;
    expect(order).toEqual(['release', 'waiter']);
  });
  it('release never removes a lock that someone else owns now; release twice is harmless', async () => {
    const dir = tmp(); const h = await acquireRefreshLock(dir); const f = join(dir, LOCK_FILE);
    writeFileSync(f, JSON.stringify({ pid: 1, owner: 'someone-else' })); await h.release(); await h.release();
    expect(JSON.parse(readFileSync(f, 'utf8')).owner).toBe('someone-else');
  });
  it('the lock file holds a pid and an owner id only, and the directory is private', async () => {
    const dir = join(tmp(), 'locks'); const h = await acquireRefreshLock(dir);
    expect(Object.keys(JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8'))).sort()).toEqual(['owner', 'pid']);
    if (process.platform !== 'win32') expect(statSync(dir).mode & 0o777).toBe(0o700);
    await h.release();
  });
});
