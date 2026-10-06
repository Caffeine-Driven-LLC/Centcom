import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createInterruptController, type InterruptTarget } from '../../src/index.js';
import { manualClock } from './rig.js';

describe('interrupt races', () => {
  it('concurrent interrupts share one ladder; an idle agent returns stoppedStream false', async () => {
    const clock = manualClock(); let calls = 0; let busy = true; const emitted: unknown[] = [];
    const t: InterruptTarget = { busy: () => busy, turnId: () => 'trn_1', interrupt: () => { calls++; return new Promise((res) => clock.setTimeout(() => { busy = false; res({ stopped: true }); }, 50)); } };
    const ctl = createInterruptController({ targets: { get: () => t, busyIds: () => (busy ? ['a'] : []) }, approvals: { cancel: () => 0 }, states: { interrupted: () => undefined }, emit: (e) => emitted.push(e), clock });
    const a = ctl.interrupt('a'); const b = ctl.interrupt('a'); await clock.advance(60); expect(await a).toBe(await b); expect(calls).toBe(1); expect(emitted).toHaveLength(1);
    expect(await ctl.interrupt('a')).toMatchObject({ stoppedStream: false, method: 'none' }); expect(await ctl.interrupt('nobody')).toMatchObject({ stoppedStream: false });
  });
  it('whatever the timing (turn ends before, during or after; engine fast, slow or silent), no interrupt stays pending', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 12_000 }), fc.integer({ min: 0, max: 12_000 }), fc.integer({ min: 1, max: 4 }), async (engineMs, endMs, n) => {
      const clock = manualClock(); let busy = true; clock.setTimeout(() => { busy = false; }, endMs);
      const t: InterruptTarget = { busy: () => busy, turnId: () => 'trn_x', interrupt: () => new Promise((res) => { clock.setTimeout(() => { busy = false; res({ stopped: true }); }, engineMs); }) };
      const ctl = createInterruptController({ targets: { get: () => t, busyIds: () => (busy ? ['a'] : []) }, approvals: { cancel: () => 0 }, states: { interrupted: () => undefined }, emit: () => undefined, clock });
      let settled = 0; const ps = Array.from({ length: n }, () => ctl.interrupt('a').then(() => { settled++; })); await clock.advance(20_000); await Promise.all(ps); expect(settled).toBe(n);
    }), { numRuns: 60 });
  });
});
