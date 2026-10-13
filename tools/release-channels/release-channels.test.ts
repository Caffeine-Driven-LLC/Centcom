import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReleaseChannels, makeTestSigner } from './channels.js';
import { main } from './run.js';
import { SCENARIO_IDS, program, runUpdateScenarios } from './scenarios.js';
import { startMockReleaseServer } from './mock-server.js';

const win = process.platform === 'win32';
describe('release channels', () => {
  it('publish, promote, yank and the minimum version; the manifest is the REST form and the signature covers the digest', async () => {
    const { signer } = await makeTestSigner(); const c = new ReleaseChannels(signer);
    const a = c.publish('nightly', { version: '1.5.0-nightly.1', files: [{ platform: 'macos', arch: 'arm64', body: Buffer.from('x') }], minSupported: '1.4.0', notesUrl: 'https://centcom.dev/n' });
    const m = c.manifest(a, 'macos', 'arm64', 'http://h'); expect(m).toMatchObject({ channel: 'nightly', version: '1.5.0-nightly.1', min_supported_version: '1.4.0', artifacts: [{ platform: 'macos', sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/), size: 1, sig_kid: 'rel-test' }] });
    expect(c.manifest(a, 'linux', 'x64', 'http://h').artifacts).toEqual([]);
    expect(c.promote('nightly', 'beta').channel).toBe('beta'); expect(c.latest('beta')?.version).toBe('1.5.0-nightly.1');
    c.publish('stable', { version: '1.4.3', files: [{ platform: 'linux', arch: 'x64', body: Buffer.from('a') }] }); c.publish('stable', { version: '1.4.4', files: [{ platform: 'linux', arch: 'x64', body: Buffer.from('b') }] });
    expect(c.yank('stable')?.version).toBe('1.4.4'); expect(c.latest('stable')?.version).toBe('1.4.3'); c.setMinSupported('stable', '1.4.2'); expect(c.latest('stable')?.minSupported).toBe('1.4.2');
    expect(() => c.publish('stable', { version: 'x', files: [] })).toThrow(); expect(() => c.publish('stable', { version: '1.0.0', files: [] })).toThrow(); expect(() => c.promote('beta', 'stable') && c.promote('stable', 'nightly')).not.toThrow(); expect(new ReleaseChannels(signer).latest('stable')).toBeUndefined();
  });
  it('the mock server answers 404 for an empty channel, serves status with the minimum, and only listens on loopback', async () => {
    const { signer } = await makeTestSigner(); const c = new ReleaseChannels(signer); const s = await startMockReleaseServer({ channels: c, minClientVersion: '1.2.0' });
    try {
      expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/); expect((await fetch(`${s.url}/v1/releases/stable/latest?platform=linux&arch=x64`)).status).toBe(404); expect(await (await fetch(`${s.url}/v1/status`)).json()).toMatchObject({ min_client_version: '1.2.0' }); expect((await fetch(`${s.url}/nope`)).status).toBe(404);
      expect(s.requests.map((r) => r.path)).toContain('/v1/status');
    } finally { await s.close(); }
  });
  it('the fake programs print their version for --version --json', () => { expect(program('1.2.3').toString()).toContain('{"version":"1.2.3"}'); expect(program('1.2.3', false).toString()).toContain('exit 1'); });
});
describe.skipIf(win)('the update path against the mock server', () => {
  it('every scenario passes (tamper, signatures, rollback, replay, channels, 426, rotation, crash recovery, live session)', async () => {
    const r = await runUpdateScenarios(); expect(r.map((x) => x.id)).toEqual(SCENARIO_IDS); for (const x of r) expect(x, `${x.id}: ${x.detail ?? ''}`).toMatchObject({ ok: true });
  }, 60_000);
  it('the runner writes update-report.json for the release gate and exits 0', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'cc-rep-')), 'update-report.json'); const lines: string[] = []; expect(await main(['--out', out], (l) => lines.push(l))).toBe(0);
    const rep = JSON.parse(readFileSync(out, 'utf8')) as { ok: boolean; scenarios: { id: string; ok: boolean }[] }; expect(rep.ok).toBe(true); expect(rep.scenarios).toHaveLength(SCENARIO_IDS.length); expect(lines.at(-1)).toBe('Update path: verified');
  }, 60_000);
});
