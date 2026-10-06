import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BranchReady } from '../../src/index.js';
import { fleetRig, sh } from './helpers.js';

describe('cleanup and branch ready (acceptance 6)', () => {
  it('commits ahead and a clean tree: onBranchReady fires once with ahead 2 and the files; the worktree and branch stay', async () => {
    const r = await fleetRig(); const seen: BranchReady[] = []; r.fleet.onBranchReady((e) => seen.push(e)); const busSeen: BranchReady[] = []; r.bus.on('fleet:branch_ready', (e) => busSeen.push(e));
    const h = await r.fleet.spawn(r.spec(1)); await r.until(() => h.state() === 'waiting'); const wt = h.describe().worktree!;
    writeFileSync(join(wt, 'one.txt'), '1'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-q', '-m', 'one'); writeFileSync(join(wt, 'two.txt'), '2'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-q', '-m', 'two');
    await r.finish(h.id); const res = await h.done(); expect(res).toEqual({ outcome: 'ok', branchReady: true }); expect(seen).toEqual([{ agentId: h.id, branch: h.branch, ahead: 2, files: ['one.txt', 'two.txt'] }]); expect(busSeen).toHaveLength(1);
    expect(existsSync(wt)).toBe(true); expect(sh(r.repo, 'branch', '--list', h.branch!).trim()).toContain(h.branch); expect(r.nodes.get(h.id)).toMatchObject({ state: 'done', attention: 'branch ready' }); await r.clock.advance(10_000); expect(seen).toHaveLength(1);
  }, 60_000);
  it('no changes: the worktree and its branch are removed', async () => { const r = await fleetRig(); const h = await r.fleet.spawn(r.spec(1)); await r.until(() => h.state() === 'waiting'); const wt = h.describe().worktree!; await r.finish(h.id); expect(await h.done()).toEqual({ outcome: 'ok', branchReady: false }); expect(existsSync(wt)).toBe(false); expect(sh(r.repo, 'branch', '--list', h.branch!).trim()).toBe(''); expect(r.nodes.get(h.id)!.attention).toBeUndefined(); }, 60_000);
  it('uncommitted changes: kept, marked needs attention, and never removed on its own, not even with commits', async () => {
    const r = await fleetRig(); const fired: BranchReady[] = []; r.fleet.onBranchReady((e) => fired.push(e)); const h = await r.fleet.spawn(r.spec(1)); await r.until(() => h.state() === 'waiting'); const wt = h.describe().worktree!; writeFileSync(join(wt, 'wip.txt'), 'unsaved'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-q', '-m', 'c'); writeFileSync(join(wt, 'more.txt'), 'dirty');
    await r.finish(h.id); expect((await h.done()).branchReady).toBe(false); expect(existsSync(join(wt, 'more.txt'))).toBe(true); expect(r.nodes.get(h.id)).toMatchObject({ attention: 'needs attention' }); expect(fired).toEqual([]); await r.fleet.remove(h.id).then(() => { throw new Error('should refuse'); }, (e) => expect(e.name).toMatch(/Dirty/)); expect(existsSync(wt)).toBe(true);
    await r.fleet.remove(h.id, { force: true }); expect(existsSync(wt)).toBe(false);
  }, 60_000);
  it('a crash is a failed agent and its worktree is judged the same way', async () => { const r = await fleetRig(); const h = await r.fleet.spawn(r.spec(1)); await r.until(() => h.state() === 'waiting'); const wt = h.describe().worktree!; writeFileSync(join(wt, 'half.txt'), 'x'); r.engines['claude-code']!.sessions[0]!.crash(); const res = await h.done(); expect(res.outcome).toBe('error'); expect(res.error_code).toBeTruthy(); expect(r.nodes.get(h.id)).toMatchObject({ state: 'failed', attention: 'needs attention' }); expect(existsSync(join(wt, 'half.txt'))).toBe(true); }, 60_000);
  it('removing a running agent is refused', async () => { const r = await fleetRig(); const h = await r.fleet.spawn(r.spec(1)); await expect(r.fleet.remove(h.id)).rejects.toMatchObject({ code: 'still_running' }); await expect(r.fleet.remove('agt_01JNOSUCH00000000000000000' as never)).rejects.toMatchObject({ code: 'not_found' }); await r.fleet.stopAll(); }, 30_000);
});
describe('start failures', () => {
  it('an engine that fails to start: the spawn rejects with its message, the untouched worktree is removed, the slot is free', async () => {
    const r = await fleetRig({ limit: 1, engineOpts: { codex: { failStart: Object.assign(new Error('codex is not installed'), { code: 'provider_not_installed' }) } } }); const err = await r.fleet.spawn(r.spec(1, { engine: 'codex' })).catch((e) => e); expect(err.message).toContain('codex is not installed'); expect(sh(r.repo, 'worktree', 'list').trim().split('\n')).toHaveLength(1);
    const node = [...r.nodes.values()][0]!; expect(node).toMatchObject({ state: 'failed', error_code: 'provider_not_installed' }); const ok = await r.fleet.spawn(r.spec(2)); await r.until(() => ok.state() !== 'queued' && ok.state() !== 'starting'); await r.fleet.stopAll();
  }, 60_000);
  it('a folder that is not a git repository: the spawn fails with that error and nothing starts', async () => { const r = await fleetRig(); const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const plain = mkdtempSync(join(tmpdir(), 'centcom-plain-')); const err = await r.fleet.spawn(r.spec(1, { repoRoot: plain })).catch((e) => e); expect(err).toBeInstanceOf(Error); expect(r.engines['claude-code']!.sessions).toHaveLength(0); expect(r.states()).toEqual(['failed']); }, 30_000);
});
