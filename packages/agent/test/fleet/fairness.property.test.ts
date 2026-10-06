import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pickNext } from '../../src/index.js';
import { fleetRig } from './helpers.js';

/** A tiny model of the host: spawns arrive, running agents finish, and the picker decides who starts. The invariant is checked at every start. */
function simulate(ops: { t: 'spawn' | 'finish'; owner: number }[], limit: number, owners: number) {
  const running = new Map<string, number>(); const waiting: { id: string; owner: string; seq: number }[] = []; let seq = 0; const violations: string[] = [];
  const startNext = () => { for (;;) { const total = [...running.values()].reduce((a, b) => a + b, 0); if (total >= limit) return; const pick = pickNext(waiting, running, limit, []); if (!pick) return; waiting.splice(waiting.findIndex((w) => w.id === pick.id), 1); const others = waiting.some((w) => w.owner !== pick.owner); const before = running.get(pick.owner) ?? 0; running.set(pick.owner, before + 1); const active = new Set([pick.owner, ...waiting.map((w) => w.owner)]); const cap = Math.ceil(limit / active.size); if (others && before + 1 > cap) violations.push(`${pick.owner} started as #${before + 1} (cap ${cap}) while others waited`); } };
  for (const op of ops) { const owner = `o${op.owner % owners}`; if (op.t === 'spawn') { waiting.push({ id: `w${++seq}`, owner, seq }); } else { const n = running.get(owner) ?? 0; if (n > 0) running.set(owner, n - 1); } startNext(); const total = [...running.values()].reduce((a, b) => a + b, 0); if (total > limit) violations.push('over the limit'); if (waiting.length && total < limit && waiting.some(() => true) && pickNext(waiting, running, limit, [])) violations.push('idle slot while spawns wait'); }
  return violations;
}
describe('fairness (acceptance 4)', () => {
  it('1,000 random schedules over three owners and limit 6: nobody is over their share while another owner waits, and no slot is left idle', () => {
    fc.assert(fc.property(fc.array(fc.record({ t: fc.constantFrom<'spawn' | 'finish'>('spawn', 'spawn', 'finish'), owner: fc.nat(2) }), { minLength: 5, maxLength: 60 }), (ops) => { expect(simulate(ops, 6, 3)).toEqual([]); }), { numRuns: 1000 });
  });
  it('the picker takes turns between owners and serves each owner in order', () => {
    const w = (id: string, owner: string, seq: number) => ({ id, owner, seq }); const picked = pickNext([w('a2', 'a', 2), w('b3', 'b', 3), w('a1', 'a', 1)], new Map([['a', 2]]), 4); expect(picked!.id).toBe('b3'); expect(pickNext([w('a2', 'a', 2), w('a1', 'a', 1)], new Map(), 4)!.id).toBe('a1'); expect(pickNext([], new Map(), 4)).toBeUndefined();
    expect(pickNext([w('a1', 'a', 1), w('b1', 'b', 2)], new Map([['a', 1], ['b', 1]]), 2)!.id).toBe('a1'); // equal: the longest waiting goes
    expect(pickNext([w('b1', 'b', 2), w('c1', 'c', 3)], new Map([['a', 1], ['b', 2], ['c', 2]]), 6)!.id).toBe('b1'); // a is not waiting, so b and c share what is left: 3 each
  });
  it('end to end: an owner alone may fill the host, but once others wait, freed slots go to them first until everyone has their share', async () => {
    const r = await fleetRig({ limit: 6 }); const hs: Awaited<ReturnType<typeof r.fleet.spawn>>[] = []; const owner = new Map<string, string>(); for (const [o, base] of [['a', 0], ['b', 10], ['c', 20]] as const) for (let i = 0; i < 4; i++) { const h = await r.fleet.spawn(r.spec(base + i, { ownerSlug: o })); hs.push(h); owner.set(h.id, o); }
    const started = (o: string) => hs.filter((h) => h.state() !== 'queued' && owner.get(h.id) === o).length; await r.until(() => r.engines['claude-code']!.sessions.length === 6); expect([started('a'), started('b'), started('c')]).toEqual([4, 2, 0]);
    for (const h of hs.filter((x) => owner.get(x.id) === 'a').slice(0, 2)) await r.finish(h.id); await r.until(() => r.engines['claude-code']!.sessions.length === 8); const live = (o: string) => hs.filter((h) => ['starting', 'running', 'waiting'].includes(h.state()) && owner.get(h.id) === o).length; expect([live('a'), live('b'), live('c')]).toEqual([2, 2, 2]);
    await r.fleet.stopAll();
  }, 90_000);
});
