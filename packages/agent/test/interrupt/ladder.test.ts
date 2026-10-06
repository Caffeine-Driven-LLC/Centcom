import { describe, expect, it } from 'vitest';
import { createProcessRegistry, signalLadder, type Sig } from '../../src/index.js';
import { alive, manualClock, recording, start } from './rig.js';

describe('signal ladder (fake clock)', () => {
  const fake = () => { const sent: { at: number; sig: Sig }[] = []; const clock = manualClock(); const procs = createProcessRegistry({ kill: (_pid, sig) => { sent.push({ at: clock.now(), sig }); } }); procs.register('a', 4242, { group: true }); return { sent, clock, procs }; };
  it('a process that ignores SIGINT gets SIGTERM at 3 s and SIGKILL at 8 s', async () => {
    const { sent, clock, procs } = fake(); let exit!: () => void; const exited = new Promise<void>((r) => { exit = r; });
    const p = signalLadder({ agentId: 'a', procs, clock, exited }); await clock.advance(2900); expect(sent.map((s) => s.sig)).toEqual(['SIGINT']);
    await clock.advance(200); expect(sent).toEqual([{ at: 0, sig: 'SIGINT' }, { at: 3000, sig: 'SIGTERM' }]);
    await clock.advance(5000); expect(sent.at(-1)).toEqual({ at: 8000, sig: 'SIGKILL' }); exit(); const r = await p; expect(r.exited).toBe(true); expect(r.terminated.map((t) => t.signal)).toEqual(['SIGINT', 'SIGTERM', 'SIGKILL']);
  });
  it('a process that exits on SIGINT gets exactly one signal', async () => {
    const { sent, clock, procs } = fake(); let exit!: () => void; const exited = new Promise<void>((r) => { exit = r; });
    const p = signalLadder({ agentId: 'a', procs, clock, exited }); await clock.advance(100); exit(); await clock.advance(10_000); await p; expect(sent.map((s) => s.sig)).toEqual(['SIGINT']);
  });
  it('hard skips the grace: SIGKILL at once', async () => {
    const { sent, clock, procs } = fake(); const p = signalLadder({ agentId: 'a', procs, clock, exited: Promise.resolve(), hard: true }); await clock.advance(0); await p; expect(sent).toEqual([{ at: 0, sig: 'SIGKILL' }]);
  });
  it('signals the process group, and nothing for an agent with no registered process', () => {
    const kills: number[] = []; const procs = createProcessRegistry({ kill: (pid) => { kills.push(pid); }, platform: 'linux' }); procs.register('a', 77, { group: true }); procs.register('b', 78);
    procs.signal('a', 'SIGINT'); procs.signal('b', 'SIGINT'); procs.signal('nobody', 'SIGKILL'); expect(kills).toEqual([-77, 78]);
    const tk: number[] = []; const win = createProcessRegistry({ platform: 'win32', kill: () => undefined, taskkill: (pid) => { tk.push(pid); } }); win.register('a', 9); win.signal('a', 'SIGKILL'); expect(tk).toEqual([9]);
  });
});

describe.skipIf(process.platform === 'win32')('signal ladder (real processes)', () => {
  it('SIGINT is enough for a process that exits on it', async () => {
    const { child, exited } = await start('exits-on-sigint'); const { procs, sent } = recording(); procs.register('a', child.pid!, { group: true });
    const r = await signalLadder({ agentId: 'a', procs, exited, graceMs: 300, killMs: 600 }); expect(r.exited).toBe(true); expect(sent.map((s) => s.sig)).toEqual(['SIGINT']); expect(sent.every((s) => s.pid === -child.pid!)).toBe(true);
  });
  it('SIGTERM for one that traps SIGINT, SIGKILL for one that ignores both', async () => {
    const a = await start('traps-sigint'); const ra = recording(); ra.procs.register('a', a.child.pid!, { group: true });
    expect((await signalLadder({ agentId: 'a', procs: ra.procs, exited: a.exited, graceMs: 200, killMs: 500 })).terminated.map((t) => t.signal)).toEqual(['SIGINT', 'SIGTERM']);
    const b = await start('ignores-sigterm'); const rb = recording(); rb.procs.register('b', b.child.pid!, { group: true });
    const r = await signalLadder({ agentId: 'b', procs: rb.procs, exited: b.exited, graceMs: 200, killMs: 500 }); expect(r.terminated.map((t) => t.signal)).toEqual(['SIGINT', 'SIGTERM', 'SIGKILL']); expect(r.exited).toBe(true); expect(alive(b.child.pid!)).toBe(false);
  });
});
