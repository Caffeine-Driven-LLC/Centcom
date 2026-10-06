import { describe, expect, it } from 'vitest';
import { createInterruptController, type InterruptTarget } from '../../src/index.js';
import { manualClock } from './rig.js';

/** A target whose engine answers the interrupt after `ms` (or never). */
function target(o: { ms?: number; never?: boolean; method?: 'protocol' | 'sigint' } = {}) {
  let busy = true; let calls = 0; const clock = manualClock();
  const t: InterruptTarget = { busy: () => busy, turnId: () => 'trn_1', interrupt: () => { calls++; return o.never ? new Promise(() => undefined) : new Promise((res) => clock.setTimeout(() => { busy = false; res({ stopped: true, method: o.method ?? 'sigint', terminated: [{ pid: 1, signal: 'SIGINT' }] }); }, o.ms ?? 10)); } };
  return { t, clock, calls: () => calls, setBusy: (b: boolean) => { busy = b; } };
}
function rig(tg = target()) {
  const pending = new Map<string, number>([['a', 2]]); const closed: string[] = []; const emitted: unknown[] = []; const idled: string[] = [];
  const ctl = createInterruptController({ targets: { get: (id) => (id === 'a' ? tg.t : undefined), busyIds: () => (tg.t.busy() ? ['a'] : []) }, approvals: { cancel: (id) => { const n = pending.get(id) ?? 0; for (let i = 0; i < n; i++) closed.push(id); pending.set(id, 0); return n; } }, states: { interrupted: (id) => idled.push(id) }, emit: (e) => emitted.push(e), clock: tg.clock });
  return { ctl, closed, emitted, idled, tg };
}

describe('interrupt and approvals', () => {
  it('two open approvals are denied and their prompts closed; a late approval for the cancelled turn is denied without asking', async () => {
    const { ctl, closed, emitted, idled, tg } = rig(); const p = ctl.interrupt('a'); await tg.clock.advance(20); const r = await p;
    expect(r).toMatchObject({ agentId: 'a', method: 'sigint', stoppedStream: true, cancelledApprovals: 2 }); expect(closed).toEqual(['a', 'a']);
    expect(ctl.cancelledTurn('trn_1')).toBe(true); expect(ctl.cancelledTurn('trn_2')).toBe(false); expect(emitted).toEqual([{ agent_id: 'a', reason: 'user', hard: false, method: 'sigint' }]); expect(idled).toEqual(['a']);
  });
  it('an engine that ignores the interrupt for 9 s is given up on: the agent goes idle anyway', async () => {
    const tg = target({ never: true }); const { ctl, idled } = rig(tg); const p = ctl.interrupt('a'); await tg.clock.advance(9000); const r = await p; expect(r.method).toBe('none'); expect(idled).toEqual(['a']);
  });
});
