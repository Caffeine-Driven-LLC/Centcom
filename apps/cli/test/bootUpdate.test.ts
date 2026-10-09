import { describe, expect, it } from 'vitest';
import { ManagedInstallError, NoUpdateError, SignatureError, type CheckResult, type InstallMethod, type StagedUpdate } from '@centcom/net';
import { bootUpdate, packageManagerArgv, updatesWanted, type BootUpdateClient } from '../src/bootUpdate.js';

const staged = { version: '2.0.0', channel: 'stable', path: '/x', artifact: {}, verified: false } as unknown as StagedUpdate;
function fake(method: InstallMethod, o: { check?: Partial<CheckResult> | Error; verify?: Error; apply?: Error; download?: Error } = {}) {
  const calls: string[] = [];
  const client: BootUpdateClient = {
    method,
    check: async () => { calls.push('check'); if (o.check instanceof Error) throw o.check; return { available: true, version: '2.0.0', channel: 'stable', required: false, ...o.check }; },
    download: async () => { calls.push('download'); if (o.download) throw o.download; return staged; },
    verify: async () => { calls.push('verify'); if (o.verify) throw o.verify; },
    apply: async () => { calls.push('apply'); if (o.apply) throw o.apply; return { restartRequired: false, previous: '1.0.0' }; },
  };
  const said: { level: string; text: string; detail?: string }[] = [];
  return { client, calls, said, deps: { client, env: {}, version: '1.0.0', check: true, auto: true, say: (level: 'info' | 'warn', text: string, detail?: string) => said.push({ level, text, detail }) } };
}

describe('the update each time Centcom starts', () => {
  it('a standalone install downloads, verifies, applies in that order, and says so', async () => {
    const f = fake('sea'); expect(await bootUpdate(f.deps)).toBe('updated'); expect(f.calls).toEqual(['check', 'download', 'verify', 'apply']);
    expect(f.said).toHaveLength(1); expect(f.said[0]!.text).toBe('Centcom updated to 2.0.0.'); expect(f.said[0]!.detail).toContain('centcom update --rollback');
  });
  it('a failed signature check stops before apply and only offers the update', async () => {
    const f = fake('sea', { verify: new SignatureError() }); expect(await bootUpdate(f.deps)).toBe('available'); expect(f.calls).not.toContain('apply'); expect(f.said[0]!.text).toBe('Centcom 2.0.0 is available.'); expect(f.said[0]!.detail).toContain('nothing was changed');
  });
  it('an update this computer has no download for is only offered', async () => {
    const f = fake('sea', { download: new NoUpdateError('none') }); expect(await bootUpdate(f.deps)).toBe('available'); expect(f.calls).toEqual(['check', 'download']);
  });
  it('npm and Homebrew installs run their own update command (never the standalone replace)', async () => {
    for (const [m, argv] of [['npm', ['npm', 'install', '--global', 'centcom@latest']], ['homebrew', ['brew', 'upgrade', 'centcom']]] as const) {
      const f = fake(m); const ran: string[][] = []; expect(await bootUpdate({ ...f.deps, run: async (a) => { ran.push(a); return true; } })).toBe('updated'); expect(ran).toEqual([argv]); expect(f.calls).toEqual(['check']);
    }
  });
  it('when the package manager fails (permissions, offline) the command is shown instead', async () => {
    const f = fake('npm'); expect(await bootUpdate({ ...f.deps, run: async () => false })).toBe('available'); expect(f.said[0]!.detail).toContain('npm install --global centcom@latest');
  });
  it('a source checkout is only told that a newer version exists', async () => {
    const f = fake('unknown'); expect(await bootUpdate(f.deps)).toBe('available'); expect(f.calls).toEqual(['check']); expect(f.said[0]!.detail).toContain('source checkout');
  });
  it('update.auto off: it says a version exists and changes nothing', async () => {
    const f = fake('sea'); expect(await bootUpdate({ ...f.deps, auto: false })).toBe('available'); expect(f.calls).toEqual(['check']); expect(f.said[0]!.detail).toContain('centcom update');
  });
  it('up to date says nothing; too old and nothing newer warns', async () => {
    const f = fake('sea', { check: { available: false, version: undefined } }); expect(await bootUpdate(f.deps)).toBe('current'); expect(f.said).toEqual([]);
    const g = fake('sea', { check: { available: false, version: undefined, required: true } }); expect(await bootUpdate(g.deps)).toBe('current'); expect(g.said[0]!.level).toBe('warn');
  });
  it('offline, slow or broken: nothing is said and nothing throws; a hung check gives up at its limit', async () => {
    const f = fake('sea', { check: new Error('offline') }); expect(await bootUpdate(f.deps)).toBe('failed'); expect(f.said).toEqual([]);
    const hung: BootUpdateClient = { ...f.client, check: (o) => new Promise((_r, rej) => o?.signal?.addEventListener('abort', () => rej(new Error('aborted')))) };
    const t0 = Date.now(); expect(await bootUpdate({ ...f.deps, client: hung, checkMs: 30 })).toBe('failed'); expect(Date.now() - t0).toBeLessThan(1000);
  });
  it('a hung download is stopped at its limit and only offered', async () => {
    const f = fake('sea'); const hung: BootUpdateClient = { ...f.client, download: (o) => new Promise((_r, rej) => o?.signal?.addEventListener('abort', () => rej(new Error('aborted')))) };
    expect(await bootUpdate({ ...f.deps, client: hung, installMs: 30 })).toBe('available');
  });
  it('a package-managed install that says managed at apply time is offered the command', async () => {
    const f = fake('sea', { download: new ManagedInstallError('brew upgrade centcom') }); expect(await bootUpdate(f.deps)).toBe('available');
  });
  it('off: update.check false, CENTCOM_NO_UPDATE_CHECK, or CI never even look', async () => {
    for (const d of [{ check: false }, { env: { CENTCOM_NO_UPDATE_CHECK: '1' } }, { env: { CENTCOM_NO_UPDATE_CHECK: 'true' } }, { env: { CI: 'true' } }]) { const f = fake('sea'); expect(await bootUpdate({ ...f.deps, ...d })).toBe('off'); expect(f.calls).toEqual([]); }
    expect(updatesWanted({ check: true, env: { CENTCOM_NO_UPDATE_CHECK: '0' } })).toBe(true); expect(packageManagerArgv('sea')).toBeUndefined();
  });
});
