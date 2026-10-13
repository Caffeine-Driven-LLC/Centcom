import { afterEach, describe, expect, it } from 'vitest';
import { applyUpdate, runStartupUpdate, nodeFs, nodeRunner, type StartupDeps } from '../../src/autoupdate/index.js';
import { rig, version, type Rig } from './helpers.js';

const win = process.platform === 'win32'; let r: Rig | undefined; afterEach(async () => { await r?.close(); r = undefined; });
const deps = (x: Rig, o: Partial<StartupDeps> = {}): StartupDeps & { said: string[] } => { const said: string[] = []; const c = x.client('stable'); const d: StartupDeps = { client: c, method: 'standalone', version: '1.4.2', channel: 'stable', channelChosen: false, platform: 'linux', check: true, auto: true, env: {}, fs: nodeFs, runner: nodeRunner, cachePath: `${x.dir}/update-check.json`, now: () => 1_000_000_000, rng: () => 0.5, sessionsLive: () => false, say: (_l, t, dd) => said.push(`${t}${dd ? ` | ${dd}` : ''}`), ...o }; return Object.assign(d, { said }); };
describe.skipIf(win)('never while a session is live', () => {
  it('applyUpdate returns deferred and touches nothing when a host or guest session is live', async () => {
    r = await rig(); r.publish('stable', '1.4.3'); const c = r.client('stable'); await c.check(); const s = await c.download(); await c.verify(s); const p = c.paths();
    for (const live of [true]) { const a = await applyUpdate({ exe: p.exe, staged: p.staged, from: '1.4.2', to: '1.4.3', platform: 'linux', sessionsLive: () => live }, nodeFs, nodeRunner); expect(a).toEqual({ ok: false, rolledBack: false, code: 'deferred' }); }
    expect(await version(r.exe)).toBe('1.4.2'); expect(r.listing()).not.toContain('centcom.previous'); expect(r.listing()).not.toContain('centcom.new');
  });
  it('the start-up check with a live session offers the update and downloads nothing; with none it brings it in', async () => {
    r = await rig(); r.publish('stable', '1.4.3'); const live = deps(r, { sessionsLive: () => true }); expect(await runStartupUpdate(live)).toBe('available'); expect(live.said[0]).toMatch(/Update available: 1\.4\.3.*waits for the next start/); expect(r.server.requests.some((q) => q.path.startsWith('/artifacts'))).toBe(false); expect(await version(r.exe)).toBe('1.4.2');
    const none = deps(r, { cachePath: `${r.dir}/other.json` }); expect(await runStartupUpdate(none)).toBe('updated'); expect(await version(r.exe)).toBe('1.4.3'); expect(none.said[0]).toContain('updated to 1.4.3');
  });
  it('a session that opens between the download and the swap defers the swap (the staged file is not applied)', async () => {
    r = await rig(); r.publish('stable', '1.4.3'); let n = 0; const d = deps(r, { sessionsLive: () => ++n > 1 }); expect(await runStartupUpdate(d)).toBe('available'); expect(d.said.at(-1)).toMatch(/waits for the next start/); expect(await version(r.exe)).toBe('1.4.2');
  });
  it('the explicit command also refuses while a session is live, and says why', async () => {
    r = await rig(); r.publish('stable', '1.4.3'); const u = await r.update(['--yes'], { sessionsLive: () => true }); expect(u.code).toBe(1); expect(u.out.join(' ')).toMatch(/A session is open/); expect(await version(r.exe)).toBe('1.4.2');
  });
});
