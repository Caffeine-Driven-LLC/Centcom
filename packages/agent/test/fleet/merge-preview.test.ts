import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fleetRig, sh } from './helpers.js';

describe('merge preview', () => {
  it('lists the files that would conflict with the base, and changes nothing', async () => {
    const r = await fleetRig(); const h = await r.fleet.spawn(r.spec(1)); await r.until(() => h.state() === 'waiting'); const wt = h.describe().worktree!;
    writeFileSync(join(wt, 'a.txt'), 'agent side\n'); writeFileSync(join(wt, 'only-agent.txt'), 'x'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-q', '-m', 'agent');
    writeFileSync(join(r.repo, 'a.txt'), 'main side\n'); sh(r.repo, 'commit', '-q', '-am', 'main change'); const before = { head: sh(r.repo, 'rev-parse', 'HEAD'), branches: sh(r.repo, 'branch', '--list'), status: sh(wt, 'status', '--porcelain') };
    expect(await r.fleet.mergePreview(h.id)).toEqual({ conflicts: ['a.txt'] }); expect(sh(r.repo, 'rev-parse', 'HEAD')).toBe(before.head); expect(sh(r.repo, 'branch', '--list')).toBe(before.branches); expect(sh(wt, 'status', '--porcelain')).toBe(before.status); await r.fleet.stopAll();
  }, 60_000);
  it('no conflicts is an empty list; an unknown agent is refused', async () => { const r = await fleetRig(); const h = await r.fleet.spawn(r.spec(1)); await r.until(() => h.state() === 'waiting'); expect(await r.fleet.mergePreview(h.id)).toEqual({ conflicts: [] }); await expect(r.fleet.mergePreview('agt_01JNOSUCH00000000000000000' as never)).rejects.toMatchObject({ code: 'not_found' }); await r.fleet.stopAll(); }, 30_000);
});
