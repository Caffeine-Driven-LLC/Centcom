import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createInterruptController, type InterruptTarget } from '../../src/index.js';
import { manualClock } from './rig.js';

function rig() {
  const clock = manualClock(); let busy = false; const modes: boolean[] = []; const exits: number[] = []; const hints: string[] = [];
  const t: InterruptTarget = { busy: () => busy, turnId: () => 'trn_1', interrupt: (o) => { modes.push(o.hard); return new Promise((res) => clock.setTimeout(() => { busy = false; res({ stopped: true }); }, 5000)); } };
  const ctl = createInterruptController({ targets: { get: () => t, busyIds: () => (busy ? ['a'] : []) }, approvals: { cancel: () => 0 }, states: { interrupted: () => undefined }, emit: () => undefined, clock });
  const proc = new EventEmitter() as unknown as NodeJS.Process; const off = ctl.onSignal(proc, { exit: (c) => exits.push(c), hint: (h) => hints.push(h) });
  return { ctl, clock, proc, off, modes, exits, hints, setBusy: (b: boolean) => { busy = b; } };
}

describe('ctrl+c', () => {
  it('during a turn: first is a soft interrupt, a second within 1 s goes hard and exits 130', async () => {
    const r = rig(); r.setBusy(true); r.proc.emit('SIGINT'); expect(r.modes).toEqual([false]); expect(r.exits).toEqual([]);
    await r.clock.advance(500); r.proc.emit('SIGINT'); expect(r.modes).toEqual([false, true]); expect(r.exits).toEqual([130]);
  });
  it('idle: the first shows a hint, a second within 2 s exits; two presses 3 s apart do not', async () => {
    const r = rig(); r.proc.emit('SIGINT'); expect(r.hints).toEqual(['Press ctrl+c again to exit']); await r.clock.advance(3000); r.proc.emit('SIGINT'); expect(r.exits).toEqual([]);
    await r.clock.advance(1500); r.proc.emit('SIGINT'); expect(r.exits).toEqual([0]); r.off(); r.proc.emit('SIGINT'); expect(r.exits).toEqual([0]);
  });
});
