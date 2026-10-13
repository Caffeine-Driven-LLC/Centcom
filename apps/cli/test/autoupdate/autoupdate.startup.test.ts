import { afterEach, describe, expect, it, vi } from 'vitest';
import { nodeFs, nodeRunner, runStartupUpdate, startUpdateCheck, type StartupDeps } from '../../src/autoupdate/index.js';
import { rig, version, type Rig } from './helpers.js';

const win = process.platform === 'win32'; let r: Rig | undefined; afterEach(async () => { await r?.close(); r = undefined; });
const deps = (x: Rig, o: Partial<StartupDeps> = {}): StartupDeps & { said: string[]; results: unknown[] } => {
  const said: string[] = []; const results: unknown[] = [];
  const d: StartupDeps = { client: x.client('stable'), method: 'standalone', version: '1.4.2', channel: 'stable', channelChosen: false, platform: 'linux', check: true, auto: true, env: {}, fs: nodeFs, runner: nodeRunner, cachePath: `${x.dir}/update-check.json`, now: () => 1_000_000_000, rng: () => 0.5, sessionsLive: () => false, say: (_l, t, dd) => said.push(`${t}${dd ? ` | ${dd}` : ''}`), onResult: (e) => results.push(e), ...o };
  return Object.assign(d, { said, results });
};
describe.skipIf(win)('the check when Centcom starts', () => {
  it('never delays the first prompt: it returns in under 20 ms even when the network takes 2 s, and the work happens after', async () => {
    r = await rig({ latencyMs: 2000 }); r.publish('stable', '1.4.3'); const d = deps(r); const t0 = performance.now(); startUpdateCheck(d); const took = performance.now() - t0; expect(took).toBeLessThan(20); expect(r.server.requests).toEqual([]);
  });
  it('is skipped under CI, with update.auto off, with update.check off and with CENTCOM_NO_UPDATE_CHECK: no request at all', async () => {
    r = await rig(); r.publish('stable', '1.4.3'); for (const o of [{ env: { CI: 'true' } }, { auto: false }, { check: false }, { env: { CENTCOM_NO_UPDATE_CHECK: '1' } }]) expect(await runStartupUpdate(deps(r, o))).toBe('skipped');
    expect(r.server.requests).toEqual([]);
  });
  it('looks at most every interval: a look is remembered on disk and the next start inside the window skips it', async () => {
    r = await rig(); r.publish('stable', '1.4.2'); let now = 1_000_000_000; const mk = () => deps(r!, { now: () => now });
    expect(await runStartupUpdate(mk())).toBe('current'); const n1 = r.server.requests.length; expect(n1).toBeGreaterThan(0);
    now += 3 * 3_600_000; expect(await runStartupUpdate(mk())).toBe('skipped'); expect(r.server.requests.length).toBe(n1);
    now += 4 * 3_600_000; expect(await runStartupUpdate(mk())).toBe('current'); expect(r.server.requests.length).toBeGreaterThan(n1);
  });
  it('beta and nightly are never auto-installed unless the user chose the channel; stable standalone installs itself, npm and brew never do', async () => {
    r = await rig(); r.publish('stable', '1.4.2'); r.publish('nightly', '1.5.0-nightly.1');
    const dflt = deps(r, { client: r.client('nightly'), channel: 'nightly', channelChosen: false }); expect(await runStartupUpdate(dflt)).toBe('available'); expect(await version(r.exe)).toBe('1.4.2'); expect(dflt.said[0]).toContain('Update available: 1.5.0-nightly.1');
    const chosen = deps(r, { client: r.client('nightly'), channel: 'nightly', channelChosen: true, cachePath: `${r.dir}/c2.json` }); expect(await runStartupUpdate(chosen)).toBe('updated'); expect(await version(r.exe)).toBe('1.5.0-nightly.1'); expect(chosen.results).toEqual([{ from: '1.4.2', to: '1.5.0-nightly.1', ok: true }]);
    for (const m of ['npm', 'brew', 'unknown'] as const) { const x = deps(r, { client: r.client('nightly'), channel: 'nightly', channelChosen: true, method: m, version: '1.0.0', cachePath: `${r.dir}/${m}.json` }); expect(await runStartupUpdate(x)).toBe('available'); }
  });
  it('a failed health check on the start-up path rolls back, tells the opt-in result once, and offers instead of claiming success', async () => {
    r = await rig(); r.publish('stable', '1.4.3', { healthy: false }); const d = deps(r); expect(await runStartupUpdate(d)).toBe('available'); expect(await version(r.exe)).toBe('1.4.2'); expect(d.results).toEqual([{ from: '1.4.2', to: '1.4.3', ok: false }]); expect(JSON.stringify(d.results)).not.toMatch(/\/|token|key/i);
  });
  it('a tampered download on the start-up path installs nothing and leaves no partial file', async () => {
    r = await rig(); r.publish('stable', '1.4.3'); r.fault.current = 'tamper'; const d = deps(r); expect(await runStartupUpdate(d)).toBe('available'); expect(r.listing().filter((f) => f !== 'update-check.json')).toEqual(['centcom']); expect(await version(r.exe)).toBe('1.4.2');
  });
  it('offline or a 426: silent for the first, and the 426 calls onTooOld once; nothing throws out of startUpdateCheck', async () => {
    r = await rig(); const tooOld = vi.fn(); r.fault.current = 'too_old_426'; expect(await runStartupUpdate(deps(r, { onTooOld: tooOld }))).toBe('failed'); expect(tooOld).toHaveBeenCalledTimes(1);
    const down = deps(r, { client: { ...r.client('stable'), method: 'sea', paths: () => ({ exe: r!.exe, staged: '', prev: '' }), check: async () => { throw new Error('offline'); }, download: async () => { throw new Error('x'); }, verify: async () => undefined, apply: async () => ({ restartRequired: true, previous: '' }) }, cachePath: `${r.dir}/d.json` }); expect(await runStartupUpdate(down)).toBe('failed'); expect(down.said).toEqual([]);
    expect(() => startUpdateCheck({ ...down, client: undefined as never })).not.toThrow();
  });
  it('a minimum version above ours calls onTooOld even when no newer version is published', async () => {
    r = await rig(); r.publish('stable', '1.4.2', { minSupported: '1.4.2' }); r.channels.setMinSupported('stable', '1.9.0'); const tooOld = vi.fn(); const d = deps(r, { onTooOld: tooOld }); expect(await runStartupUpdate(d)).toBe('current'); expect(tooOld).toHaveBeenCalledTimes(1); expect(d.said[0]).toMatch(/too old/);
  });
});
