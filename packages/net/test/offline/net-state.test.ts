import { describe, expect, it } from 'vitest';
import { NetStateMonitor, OfflineError, cachedForDisplay, requireOnline, toMascotState, type LinkSource, type NetState } from '../../src/index.js';
import { ManualClock } from '../session/rig.js';

type Link = 'online' | 'reconnecting' | 'offline';
const source = () => { let l: Link = 'online'; const fns = new Set<(x: Link) => void>(); const s: LinkSource & { set(x: Link): void } = { link: () => l, on: (_e, fn) => { fns.add(fn); return () => fns.delete(fn); }, set(x) { l = x; for (const f of [...fns]) f(x); } }; return s; };
const mk = (status: () => Promise<{ status: string }> = async () => ({ status: 'ok' })) => { const clock = new ManualClock(); const link = source(); const events: string[] = []; const mascot: string[] = []; const m = new NetStateMonitor({ sessions: () => [link], status: status as never, clock }); m.on('change', (s, p) => { events.push(`${p}>${s}`); const a = toMascotState(p); const b = toMascotState(s); if (a !== b) mascot.push(b); }); return { clock, link, m, events, mascot }; };

describe('transitions (acceptance 1, 6)', () => {
  it('online -> reconnecting on the first close, offline from the second failed attempt, online again when the socket is back; the status-line names change once each', async () => {
    const { m, link, events, mascot } = mk(); m.start(); await Promise.resolve(); expect(m.current()).toBe('online'); link.set('reconnecting'); expect(m.current()).toBe('reconnecting'); link.set('reconnecting'); expect(m.current()).toBe('offline'); link.set('online'); expect(m.current()).toBe('online'); expect(events).toEqual(['online>reconnecting', 'reconnecting>offline', 'offline>online']); expect(mascot).toEqual(['reconnecting', 'offline', 'online']); m.stop();
  });
  it('a socket that gave up is offline at once', async () => { const { m, link } = mk(); m.start(); link.set('offline'); expect(m.current()).toBe('offline'); link.set('online'); expect(m.current()).toBe('online'); m.stop(); });
  it('a partial outage is degraded: shown, but nothing is closed and nothing is asked to reconnect', async () => {
    let status = 'ok'; const { m, clock, link, mascot } = mk(async () => ({ status })); m.start(); await Promise.resolve(); await Promise.resolve(); expect(m.current()).toBe('online'); status = 'partial_outage'; await clock.advance(15_100); await Promise.resolve(); await Promise.resolve(); expect(m.current()).toBe('degraded'); expect(link.link()).toBe('online'); expect(mascot).toEqual([]); status = 'ok'; await clock.advance(15_100); await Promise.resolve(); await Promise.resolve(); expect(m.current()).toBe('online'); m.stop();
  });
  it('server errors mean backend-down; two failures to reach it mean offline; both clear when it answers again', async () => {
    let mode: 'ok' | 'down' | 'unreachable' = 'down'; const { m, clock } = mk(async () => { if (mode === 'down') throw Object.assign(new Error('x'), { status: 503 }); if (mode === 'unreachable') throw new Error('network'); return { status: 'ok' }; }); m.start(); await Promise.resolve(); await Promise.resolve(); expect(m.current()).toBe('backend-down');
    mode = 'unreachable'; await clock.advance(15_100); await Promise.resolve(); await Promise.resolve(); expect(m.current()).not.toBe('online'); await clock.advance(15_100); await Promise.resolve(); await Promise.resolve(); expect(m.current()).toBe('offline'); mode = 'ok'; await clock.advance(15_100); await Promise.resolve(); await Promise.resolve(); expect(m.current()).toBe('online'); m.stop();
  });
  it('the mascot names: degraded counts as online, backend-down as offline', () => { expect((['online', 'reconnecting', 'offline', 'degraded', 'backend-down'] as NetState[]).map(toMascotState)).toEqual(['online', 'reconnecting', 'offline', 'online', 'offline']); });
});
describe('hosted-only actions (acceptance 5, 9)', () => {
  it('fail at once when the state says so, and within a second when the call hangs; they run when online', async () => {
    await expect(requireOnline(async () => 1, { state: () => 'offline' })).rejects.toBeInstanceOf(OfflineError); await expect(requireOnline(async () => 1, { state: () => 'backend-down' })).rejects.toBeInstanceOf(OfflineError); expect(await requireOnline(async () => 7, { state: () => 'online' })).toBe(7); expect(await requireOnline(async () => 8, { state: () => 'degraded' })).toBe(8);
    const t0 = Date.now(); await expect(requireOnline(() => new Promise(() => undefined), { timeoutMs: 100 })).rejects.toBeInstanceOf(OfflineError); expect(Date.now() - t0).toBeLessThan(500); await expect(requireOnline(async () => { throw new Error('real failure'); })).rejects.toThrow('real failure');
  });
  it('cached entitlements may be shown for 24 hours and are marked stale after that', () => { const t = Date.UTC(2026, 9, 7); expect(cachedForDisplay(t, t + 23 * 3_600_000)).toEqual({ usable: true, stale: false }); expect(cachedForDisplay(t, t + 24 * 3_600_000 + 1)).toEqual({ usable: true, stale: true }); });
});
