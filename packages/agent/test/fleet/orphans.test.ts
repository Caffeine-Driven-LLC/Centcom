import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFleetManager } from '../../src/index.js';
import { fleetRig } from './helpers.js';

describe('orphans (acceptance 9)', () => {
  it('after a simulated crash the three leftover worktrees are listed and none is removed', async () => {
    const r = await fleetRig(); const left = []; for (let i = 0; i < 3; i++) left.push(await r.worktrees.create({ repoRoot: r.repo, agentId: r.ids.next('agt'), ownerSlug: 'alex', label: `old-${i}`, baseRef: 'main' }));
    const fresh = createFleetManager({ runner: r.runner, worktrees: r.worktrees, entitlements: { maxParallelAgents: () => 4 }, bus: r.bus, ids: r.ids, clock: r.clock }); const found = await fresh.recoverOrphans(r.repo);
    expect(found.map((w) => w.path).sort()).toEqual(left.map((w) => w.path).sort()); for (const w of left) expect(existsSync(w.path)).toBe(true); expect((await fresh.recoverOrphans(r.repo)).length).toBe(3); fresh.dispose();
  }, 30_000);
  it('a running agent is not an orphan', async () => { const r = await fleetRig(); const h = await r.fleet.spawn(r.spec(1)); await r.until(() => h.state() === 'waiting'); expect(await r.fleet.recoverOrphans(r.repo)).toEqual([]); await r.fleet.stopAll(); }, 30_000);
});
