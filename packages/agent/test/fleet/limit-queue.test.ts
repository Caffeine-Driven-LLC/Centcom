import { describe, expect, it } from 'vitest';
import { FleetQueueFull } from '../../src/index.js';
import { fleetRig } from './helpers.js';

describe('limit and queue (acceptance 1)', () => {
  it('limit 4, six spawns: four engines start, two are queued, and a finished slot goes to the oldest queued', async () => {
    const r = await fleetRig({ limit: 4 }); const hs = []; for (let i = 1; i <= 6; i++) hs.push(await r.fleet.spawn(r.spec(i)));
    await r.until(() => r.count('queued') === 2 && r.engines['claude-code']!.sessions.length === 4); expect(r.count('queued')).toBe(2); expect(hs.slice(4).map((h) => h.state())).toEqual(['queued', 'queued']);
    await r.finish(hs[1]!.id); await r.until(() => r.engines['claude-code']!.sessions.length === 5); expect(hs[4]!.state()).not.toBe('queued'); expect(hs[5]!.state()).toBe('queued'); expect(r.engines['claude-code']!.sessions[4]!.prompts[0]).toBe('task 5');
    await r.fleet.stopAll();
  }, 30_000);
  it('the 33rd waiting spawn is refused with FleetQueueFull', async () => {
    const r = await fleetRig({ limit: 1 }); await r.fleet.spawn(r.spec(0)); for (let i = 1; i <= 32; i++) await r.fleet.spawn(r.spec(i)); await expect(r.fleet.spawn(r.spec(33))).rejects.toBeInstanceOf(FleetQueueFull); expect(r.count('queued')).toBe(32); await r.fleet.stopAll();
  }, 60_000);
  it('the limit is the smaller of the plan and the config, and follows the plan when it changes', async () => {
    const r = await fleetRig({ limit: 8, config: { max_parallel: 2 } }); for (let i = 1; i <= 4; i++) await r.fleet.spawn(r.spec(i)); await r.until(() => r.count('queued') === 2); expect(r.engines['claude-code']!.sessions).toHaveLength(2);
    const w = await fleetRig({ limit: 2, config: { max_parallel: 8 } }); for (let i = 1; i <= 4; i++) await w.fleet.spawn(w.spec(i)); await w.until(() => w.count('queued') === 2); const first = w.fleet.list()[0]!; await w.finish(first.id as never); await w.until(() => w.engines['claude-code']!.sessions.length === 3); await r.fleet.stopAll(); await w.fleet.stopAll();
  }, 60_000);
  it('a runner with fewer slots than the limit makes the spawn wait instead of failing', async () => { const r = await fleetRig({ limit: 4, runnerMax: 2 }); const hs = []; for (let i = 1; i <= 3; i++) hs.push(await r.fleet.spawn(r.spec(i))); await r.until(() => r.engines['claude-code']!.sessions.length === 2); await r.until(() => r.count('queued') === 1); await r.finish(hs[0]!.id); await r.until(() => r.engines['claude-code']!.sessions.length === 3); await r.fleet.stopAll(); }, 30_000);
  it('a queued spawn can be stopped and never starts', async () => { const r = await fleetRig({ limit: 1 }); await r.fleet.spawn(r.spec(1)); const q = await r.fleet.spawn(r.spec(2)); await r.fleet.stop(q.id); expect(q.state()).toBe('canceled'); expect(await q.done()).toEqual({ outcome: 'canceled', branchReady: false }); expect(r.engines['claude-code']!.sessions).toHaveLength(1); await r.fleet.stopAll(); }, 30_000);
});
