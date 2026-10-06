import { describe, expect, it } from 'vitest';
import { fleetRig } from './helpers.js';

describe('stop and stopAll (acceptance 5)', () => {
  it('eight running agents, one deaf to interrupts and polite signals: all stopped within 8 s, all canceled, no timers left', async () => {
    const r = await fleetRig({ limit: 8, engineOpts: { 'claude-code': { script: (_t, session) => (session.prompts[0] === 'task 3' ? { hang: true, ignoreInterrupt: true, ignoreTerm: true } : { hang: true }) } } });
    const hs = []; for (let i = 1; i <= 8; i++) hs.push(await r.fleet.spawn(r.spec(i))); const deaf = { id: hs[2]!.id }; await r.until(() => r.engines['claude-code']!.sessions.length === 8 && r.count('running') === 8);
    let finished = false; const t0 = r.clock.now(); const p = r.fleet.stopAll().then(() => { finished = true; }); for (let i = 0; i < 400 && !finished; i++) { await r.clock.advance(50); await r.tick(); } await p; expect(r.clock.now() - t0).toBeLessThanOrEqual(8000);
    await r.until(() => r.count('canceled') === 8); expect(r.states().every((s) => s === 'canceled')).toBe(true); expect(r.runner.list().filter((a) => a.status !== 'exited')).toEqual([]); const deafSession = r.engines['claude-code']!.sessions.find((s) => s.o.agentId === deaf.id)!; expect(deafSession.signals).toContain('SIGKILL'); expect(deafSession.dead).toBe(true);
    r.fleet.dispose(); expect(r.clock.pending()).toBe(0);
  }, 90_000);
  it('stop on one agent leaves the others running and frees its slot', async () => { const r = await fleetRig({ limit: 2, engineOpts: { 'claude-code': { script: { hang: true } } } }); const a = await r.fleet.spawn(r.spec(1)); const b = await r.fleet.spawn(r.spec(2)); const c = await r.fleet.spawn(r.spec(3)); await r.until(() => r.engines['claude-code']!.sessions.length === 2); const p = r.fleet.stop(a.id); for (let i = 0; i < 100 && a.state() !== 'canceled'; i++) { await r.clock.advance(100); await r.tick(); } await p; expect(a.state()).toBe('canceled'); expect(b.state()).not.toBe('canceled'); await r.until(() => c.state() !== 'queued'); await r.fleet.stopAll(); }, 60_000);
  it('stopAll on an empty fleet and a repeated stop do nothing', async () => { const r = await fleetRig(); await r.fleet.stopAll(); const h = await r.fleet.spawn(r.spec(1)); await r.fleet.stop(h.id); await r.fleet.stop(h.id); await r.fleet.stop('agt_01JNOSUCH00000000000000000' as never); });
});
describe('wall clock cap', () => {
  it('stops an agent after max_minutes, with the reason fleet_timeout, and clears its timer when it ends earlier', async () => {
    const r = await fleetRig({ limit: 4, config: { max_minutes: 2 }, engineOpts: { 'claude-code': { script: { hang: true } } } }); const a = await r.fleet.spawn(r.spec(1)); const b = await r.fleet.spawn(r.spec(2)); await r.until(() => r.count('running') === 2);
    await r.finish(b.id); await r.until(() => b.state() === 'done' || b.state() === 'canceled'); await r.clock.advance(119_000); expect(a.state()).toBe('running'); for (let i = 0; i < 100 && a.state() === 'running'; i++) { await r.clock.advance(100); await r.tick(); } await r.until(() => a.state() === 'canceled'); expect(await a.done()).toMatchObject({ outcome: 'canceled', error_code: 'fleet_timeout' });
    expect((await b.done()).error_code).toBeUndefined();
  }, 60_000);
  it('0 means no cap', async () => { const r = await fleetRig({ config: { max_minutes: 0 } }); const a = await r.fleet.spawn(r.spec(1)); await r.until(() => r.count('waiting') === 1); await r.clock.advance(24 * 3600_000); expect(a.state()).toBe('waiting'); await r.fleet.stopAll(); }, 60_000);
});
