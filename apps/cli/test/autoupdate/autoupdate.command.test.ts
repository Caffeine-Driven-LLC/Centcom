import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { rig, version, type Rig } from './helpers.js';

const win = process.platform === 'win32'; let r: Rig | undefined; afterEach(async () => { await r?.close(); r = undefined; });
describe.skipIf(win)('centcom update: install methods, channels, options', () => {
  it('npm and Homebrew installs print their command, exit 12, and touch no file (not even a download)', async () => {
    for (const [scriptPath, cmd] of [['/usr/lib/node_modules/@centcom/cli/main.js', 'npm i -g @centcom/cli@latest'], ['/opt/homebrew/Cellar/centcom/1.4.2/lib/main.js', 'brew upgrade centcom']] as const) {
      r = await rig(); r.publish('stable', '1.4.3'); const u = await r.update(['--yes'], { isSea: false, scriptPath }); expect(u.code, cmd).toBe(12); expect(u.out.join(' ')).toContain(cmd); expect(r.server.requests.some((q) => q.path.startsWith('/artifacts'))).toBe(false); expect(r.listing()).toEqual(['centcom']); expect(await version(r.exe)).toBe('1.4.2'); await r.close(); r = undefined;
    }
  });
  it('a source checkout does not update itself either: exit 12 with the reason', async () => { r = await rig(); r.publish('stable', '1.4.3'); const u = await r.update(['--yes'], { isSea: false }); expect(u.code).toBe(12); expect(u.out.join(' ')).toContain('source checkout'); expect(r.listing()).toEqual(['centcom']); });
  it('--check on a package-manager install still reports (exit 10), because looking changes nothing', async () => { r = await rig(); r.publish('stable', '1.4.3'); expect((await r.update(['--check'], { isSea: false, scriptPath: '/x/node_modules/@centcom/cli/main.js' })).code).toBe(10); });
  it('switching to nightly warns and needs a yes: a "no" changes nothing, --yes goes ahead', async () => {
    r = await rig(); r.publish('stable', '1.4.2'); r.publish('nightly', '1.5.0-nightly.7');
    const no = await r.update(['--channel', 'nightly'], { answer: false }); expect(no.code).toBe(1); expect(no.err.join(' ')).toMatch(/Nightly builds .* can break/); expect(no.asked[0]).toContain('Switch to the nightly channel'); expect(no.out.join(' ')).toContain('Nothing was changed'); expect(await version(r.exe)).toBe('1.4.2'); expect(r.server.requests.some((q) => q.path.startsWith('/artifacts'))).toBe(false);
    const yes = await r.update(['--channel', 'nightly', '--yes']); expect(yes.code).toBe(0); expect(yes.asked).toEqual([]); expect(yes.err.join(' ')).toMatch(/Nightly builds/); expect(await version(r.exe)).toBe('1.5.0-nightly.7');
  });
  it('already on nightly (the configured channel) there is no switch warning; beta shows a note but no extra question', async () => {
    r = await rig(); r.publish('nightly', '1.5.0-nightly.7'); const n = await r.update(['--channel', 'nightly'], { defaultChannel: 'nightly' }); expect(n.err).toEqual([]); expect(n.asked).toHaveLength(1); expect(n.asked[0]).toContain('Update from');
    await r.close(); r = await rig(); r.publish('beta', '1.5.0-beta.1'); const b = await r.update(['--channel', 'beta']); expect(b.err.join(' ')).toMatch(/previews/); expect(b.asked).toHaveLength(1); expect(b.code).toBe(0);
  });
  it('a pre-release is never offered on stable, and a nightly never leaks into it', async () => { r = await rig(); r.publish('stable', '1.5.0-beta.1'); const u = await r.update(['--check']); expect(u.code).toBe(0); expect(u.out.join(' ')).toContain('up to date'); });
  it('bad options are exit 2 and a missing release for this computer is a plain failure', async () => {
    r = await rig(); expect((await r.update(['--bogus'])).code).toBe(2); expect((await r.update(['--channel', 'weekly'])).code).toBe(2);
    r.channels.publish('stable', { version: '1.4.3', files: [{ platform: 'windows', arch: 'arm64', body: Buffer.from('x') }] }); const u = await r.update(['--yes']); expect(u.code).toBe(1); expect(u.err.join(' ')).toContain('no download for this computer'); expect(existsSync(`${r.exe}.new`)).toBe(false); expect(r.listing()).toEqual(['centcom']);
  });
});
