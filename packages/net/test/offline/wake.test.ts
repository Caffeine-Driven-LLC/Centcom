import { describe, expect, it } from 'vitest';
import { ResumeCoordinator, WakeDetector, type SessionHandle } from '../../src/index.js';
import { ManualClock } from '../session/rig.js';

describe('wake from sleep (acceptance 7)', () => {
  it('a gap over 30 s reconnects every target within 2 s, spread out; a normal tick does nothing', async () => {
    const clock = new ManualClock(); const calls: number[] = []; const targets = Array.from({ length: 5 }, (_, i) => ({ reconnect: () => calls.push(i * 0 + clock.now()) })); let seed = 3; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; const wakes: number[] = [];
    const w = new WakeDetector({ clock, targets: () => targets, rng, onWake: (g) => wakes.push(g) }); w.start(); await clock.advance(5000); await clock.advance(5000); expect(calls).toHaveLength(0);
    const t0 = clock.now(); clock.t += 45_000; await clock.advance(5000); await clock.advance(2100); expect(wakes).toHaveLength(1); expect(wakes[0]!).toBeGreaterThan(30_000); expect(calls).toHaveLength(5); expect(calls.every((t) => t - t0 <= 52_100)).toBe(true); expect(new Set(calls).size).toBeGreaterThan(1); w.stop(); calls.length = 0; clock.t += 60_000; await clock.advance(10_000); expect(calls).toHaveLength(0);
  });
  it('one target that throws does not stop the others', async () => { const clock = new ManualClock(); const ok: string[] = []; const w = new WakeDetector({ clock, targets: () => [{ reconnect: () => { throw new Error('stuck'); } }, { reconnect: () => ok.push('b') }], maxJitterMs: 10 }); w.start(); clock.t += 120_000; await clock.advance(5000); await clock.advance(50); expect(ok).toEqual(['b']); w.stop(); });
});
describe('resume coordinator (acceptance 4)', () => {
  it('reports a snapshot restore and says "earlier history unavailable" once', () => {
    const handlers = new Map<string, (x: never) => void>(); const session = { on: (n: string, fn: (x: never) => void) => { handlers.set(n, fn); return () => handlers.delete(n); } } as unknown as SessionHandle; const rc = new ResumeCoordinator(session); const out: string[] = []; rc.on('restored', (r) => out.push(`restored:${r.seq}`)); rc.on('history-incomplete', () => out.push('incomplete'));
    handlers.get('snapshot')!({ seq: 900, doc: { fmt: 'centcom.snapshot', v: 1, seq: 900 } } as never); handlers.get('protocol-warning')!({ reason: 'snapshot_invalid' } as never); handlers.get('protocol-warning')!({ reason: 'earlier_history_unavailable' } as never); handlers.get('protocol-warning')!({ reason: 'earlier_history_unavailable' } as never); expect(out).toEqual(['restored:900', 'incomplete']); rc.dispose(); expect(handlers.size).toBe(0);
  });
});
