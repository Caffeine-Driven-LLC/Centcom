import { describe, expect, it } from 'vitest';
import { FleetEnginePaused } from '../../src/index.js';
import { fleetRig } from './helpers.js';

const capEvents = [{ type: 'error' as const, code: 'provider_cap_reached' as const, tool_message: 'You have reached your usage limit. It resets at 17:00.', fatal: false }];
describe('pacing (acceptance 3)', () => {
  it('spawns for one engine are at least 1,500 ms apart; another engine is paced on its own', async () => {
    const r = await fleetRig({ limit: 8, config: { stagger_ms: 1500 } }); const hs = [await r.fleet.spawn(r.spec(1)), await r.fleet.spawn(r.spec(2)), await r.fleet.spawn(r.spec(3)), await r.fleet.spawn(r.spec(4, { engine: 'codex' }))];
    await r.until(() => r.decidedAt.size === 4, { stepMs: 250, max: 400 }); const at = hs.map((h) => r.decidedAt.get(h.id)!); expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(1500); expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(1500); expect(at[3]! - at[0]!).toBeLessThan(1500); expect(at[0]).toBeLessThan(at[1]!); await r.fleet.stopAll();
  }, 60_000);
  it('after a cap event from one Claude agent new Claude spawns are refused, Codex still starts, and nothing running is interrupted', async () => {
    const r = await fleetRig({ limit: 8, engineOpts: { 'claude-code': { script: (_t, session) => (session.prompts[0] === 'task 2' ? { events: capEvents, hang: true } : { hang: true }) } } }); const a = await r.fleet.spawn(r.spec(1)); const b = await r.fleet.spawn(r.spec(2));
    await r.until(() => r.fleet.paused().length === 1); expect(r.fleet.paused()[0]).toMatchObject({ engine: 'claude-code', code: 'provider_cap_reached', message: 'You have reached your usage limit. It resets at 17:00.' });
    const err = await r.fleet.spawn(r.spec(3)).catch((e) => e); expect(err).toBeInstanceOf(FleetEnginePaused); expect(err.message).toContain('resets at 17:00'); const c = await r.fleet.spawn(r.spec(4, { engine: 'codex' })); await r.until(() => r.engines.codex!.sessions.length === 1); expect(c.state()).not.toBe('queued');
    for (const s of r.engines['claude-code']!.sessions) expect(s.interrupts).toBe(0); expect(a.state()).not.toBe('canceled'); expect(b.state()).not.toBe('failed'); await r.fleet.stopAll();
  }, 60_000);
  it('already queued spawns for a paused engine wait, and go when it is resumed', async () => {
    const r = await fleetRig({ limit: 1, engineOpts: { 'claude-code': { script: { events: [{ type: 'status', state: 'thinking' }, ...capEvents], gapMs: 1000, hang: true } } } }); await r.fleet.spawn(r.spec(1)); const q = await r.fleet.spawn(r.spec(2)); await r.until(() => r.fleet.paused().length === 1, { stepMs: 500 }); expect(q.state()).toBe('queued');
    await r.runner.get(r.fleet.list()[0]!.id as never)!.stop(); await r.tick(); await r.tick(); expect(q.state()).toBe('queued'); r.fleet.resume('claude-code'); await r.until(() => q.state() !== 'queued'); expect(r.fleet.paused()).toEqual([]); await r.fleet.stopAll();
  }, 60_000);
  it('a pause with a retry time ends by itself', async () => { const r = await fleetRig({ limit: 4, engineOpts: { 'claude-code': { script: { events: [{ type: 'error', code: 'provider_rate_limited', tool_message: 'Slow down.', fatal: false, retry: { attempt: 1, max_retries: 3, delay_ms: 30_000 } }], hang: true } } } }); await r.fleet.spawn(r.spec(1)); await r.until(() => r.fleet.paused().length === 1); await r.clock.advance(29_999); expect(r.fleet.paused()).toHaveLength(1); await r.clock.advance(1); expect(r.fleet.paused()).toEqual([]); await r.fleet.stopAll(); }, 60_000);
});
