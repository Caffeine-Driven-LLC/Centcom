/** The update path, end to end, against the mock release server: the real update client (check, download, SHA-256 and Ed25519 verification) and the real apply step
 *  (swap, health check, rollback) on real files, with the attacks and failures that must not get through. The programs being "installed" are small shell scripts that print
 *  `{"version": ...}` for `--version --json`, so the health check runs a real child process. POSIX only.
 *  `pnpm release:update-check` runs these and writes `release-gate-inputs/update-report.json` for the release gate's `update` line. */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CentcomError, UpdateClient, createHttpClient, type Channel as NetChannel } from '../../packages/net/src/index.js';
import { applyUpdate, nodeFs, nodeRunner, recoverInterrupted, trustedKeys, isTooOldSignal } from '../../apps/cli/src/autoupdate/index.js';
import { ReleaseChannels, makeTestSigner, type Channel } from './channels.js';
import { startMockReleaseServer, type Fault } from './mock-server.js';

export interface ScenarioResult { id: string; ok: boolean; detail?: string }
export const program = (version: string, healthy = true): Buffer => Buffer.from(`#!/bin/sh\nif [ "$1" = "--version" ]; then ${healthy ? `echo '{"version":"${version}"}'` : 'exit 1'}; fi\n`);
const runVersion = async (exe: string): Promise<string | undefined> => { const r = await nodeRunner.run(exe, ['--version', '--json'], { timeoutMs: 5000 }); try { return (JSON.parse(r.stdout) as { version?: string }).version; } catch { return undefined; } };

interface World { dir: string; exe: string; channels: ReleaseChannels; fault: { current: Fault }; url: string; client(o?: { channel?: Channel; keys?: string[]; current?: string }): UpdateClient; publicKey: string; close(): Promise<void>; signerId: string }
async function world(installed = '1.4.2'): Promise<World> {
  const { signer, publicKey } = await makeTestSigner('rel-test'); const channels = new ReleaseChannels(signer); const fault = { current: 'none' as Fault };
  const srv = await startMockReleaseServer({ channels, fault: () => fault.current });
  const dir = mkdtempSync(join(tmpdir(), 'cc-chan-')); const exe = join(dir, 'centcom'); writeFileSync(exe, program(installed)); chmodSync(exe, 0o755);
  const http = createHttpClient({ baseUrl: srv.url, getAccessToken: async () => undefined, userAgent: 'centcom-cli/1.4.2 (contract/1.0.0; linux-x64; node/22.0.0)' });
  return { dir, exe, channels, fault, url: srv.url, publicKey, signerId: signer.id,
    client: (o = {}) => new UpdateClient({ http, currentVersion: o.current ?? installed, platform: 'linux', arch: 'x64', channel: (o.channel ?? 'stable') as NetChannel, keys: o.keys ? { keys: [{ id: signer.id, publicKey: o.keys[0]! }] } : { keys: [{ id: signer.id, publicKey }] }, installDir: dir, exePath: exe, install: { execPath: exe, isSea: true } }),
    close: async () => { await srv.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const files = (v: string, healthy = true) => [{ platform: 'linux' as const, arch: 'x64' as const, body: program(v, healthy) }];
const only = (dir: string): string[] => readdirSync(dir).sort();

const SCENARIOS: { id: string; run(w: World): Promise<string | void> }[] = [
  { id: 'update-happy-path', async run(w) {
    w.channels.publish('stable', { version: '1.4.3', files: files('1.4.3') }); const c = w.client(); const r = await c.check(); if (!r.available || r.version !== '1.4.3') return 'not offered';
    const s = await c.download(); await c.verify(s); const p = c.paths(); const a = await applyUpdate({ exe: p.exe, staged: p.staged, from: '1.4.2', to: s.version, platform: 'linux' }, nodeFs, nodeRunner);
    if (!a.ok) return `apply failed: ${a.code}`; if ((await runVersion(w.exe)) !== '1.4.3') return 'new version does not run'; if ((await runVersion(`${w.exe}.previous`)) !== '1.4.2') return 'previous copy missing'; if (only(w.dir).join() !== 'centcom,centcom.previous') return `leftovers: ${only(w.dir).join()}`; } },
  { id: 'tampered-artifact-refused', async run(w) {
    w.channels.publish('stable', { version: '1.4.3', files: files('1.4.3') }); w.fault.current = 'tamper'; const c = w.client(); await c.check(); const s = await c.download();
    try { await c.verify(s); return 'a changed byte was accepted'; } catch (e) { if ((e as { code?: string }).code !== 'hash_mismatch') return `wrong error ${(e as Error).message}`; }
    if (only(w.dir).join() !== 'centcom') return `partial files left: ${only(w.dir).join()}`; if ((await runVersion(w.exe)) !== '1.4.2') return 'old program changed'; } },
  { id: 'bad-and-unknown-signatures-refused', async run(w) {
    w.channels.publish('stable', { version: '1.4.3', files: files('1.4.3') });
    for (const f of ['bad_signature', 'unknown_kid'] as const) { w.fault.current = f; const c = w.client(); await c.check(); const s = await c.download(); try { await c.verify(s); return `${f} accepted`; } catch (e) { if ((e as { code?: string }).code !== 'bad_signature') return `${f}: wrong error`; } }
    const other = await makeTestSigner('other'); w.fault.current = 'none'; const c = w.client({ keys: [other.publicKey] }); await c.check(); const s = await c.download(); try { await c.verify(s); return 'a key we do not trust was accepted'; } catch { /* refused */ }
    if (only(w.dir).join() !== 'centcom') return 'partial files left'; } },
  { id: 'unhealthy-update-rolled-back', async run(w) {
    w.channels.publish('stable', { version: '1.4.3', files: files('1.4.3', false) }); const c = w.client(); await c.check(); const s = await c.download(); await c.verify(s); const p = c.paths();
    const a = await applyUpdate({ exe: p.exe, staged: p.staged, from: '1.4.2', to: '1.4.3', platform: 'linux' }, nodeFs, nodeRunner); if (a.ok || !a.rolledBack || a.code !== 'health_check_failed') return `unexpected ${JSON.stringify(a)}`;
    if ((await runVersion(w.exe)) !== '1.4.2') return 'old version not restored'; if (!existsSync(`${w.exe}.previous`)) return 'no .previous kept'; if (existsSync(`${w.exe}.new`)) return '.new left behind'; } },
  { id: 'replayed-old-release-is-a-downgrade-and-refused', async run(w) {
    w.channels.publish('stable', { version: '1.4.0', files: files('1.4.0') }); w.channels.publish('stable', { version: '1.4.3', files: files('1.4.3') }); w.fault.current = 'replay_old'; const c = w.client(); const r = await c.check();
    if (r.available) return 'an older release was offered'; if (r.downgrade?.version !== '1.4.0') return 'downgrade not reported'; const ok = await w.client().check({ allowDowngrade: true }); if (!ok.available) return 'allow-downgrade did not offer it'; } },
  { id: 'wrong-channel-manifest-ignored', async run(w) {
    w.channels.publish('stable', { version: '1.4.3', files: files('1.4.3') }); w.fault.current = 'wrong_channel'; const r = await w.client().check(); if (r.available) return 'a manifest for another channel was offered'; } },
  { id: 'channels-promote-and-yank', async run(w) {
    w.channels.publish('stable', { version: '1.4.2', files: files('1.4.2') }); w.channels.publish('nightly', { version: '1.5.0-nightly.1', files: files('1.5.0-nightly.1') }); const n = await w.client({ channel: 'nightly' }).check(); if (n.version !== '1.5.0-nightly.1') return 'nightly not offered';
    const s = await w.client().check(); if (s.available) return 'a nightly leaked into stable'; w.channels.promote('nightly', 'beta'); const b = await w.client({ channel: 'beta' }).check(); if (!b.available) return 'promote did not reach beta';
    w.channels.publish('stable', { version: '1.4.3', files: files('1.4.3') }); w.channels.publish('stable', { version: '1.4.4', files: files('1.4.4') }); w.channels.yank('stable'); const y = await w.client().check(); if (y.version !== '1.4.3') return 'yank did not serve the earlier release'; } },
  { id: 'too-old-426-and-minimum-version', async run(w) {
    w.fault.current = 'too_old_426'; try { await w.client().check(); return '426 was not an error'; } catch (e) { if (!(e instanceof CentcomError) || !isTooOldSignal(e)) return 'not recognised as too old'; }
    w.fault.current = 'none'; w.channels.publish('stable', { version: '1.4.3', files: files('1.4.3'), minSupported: '1.4.3' }); const r = await w.client().check(); if (!r.required) return 'min_supported above us was not "required"'; } },
  { id: 'key-rotation-two-keys-valid', async run(w) {
    const next = await makeTestSigner('rel-next'); w.channels.rotate(next.signer); w.channels.publish('stable', { version: '1.4.3', files: files('1.4.3') });
    const http = createHttpClient({ baseUrl: w.url, getAccessToken: async () => undefined, userAgent: 'centcom-cli/1.4.2 (contract/1.0.0; linux-x64; node/22.0.0)' });
    const both = new UpdateClient({ http, currentVersion: '1.4.2', platform: 'linux', arch: 'x64', channel: 'stable', keys: { keys: [{ id: w.signerId, publicKey: w.publicKey }, { id: 'rel-next', publicKey: next.publicKey }] }, installDir: w.dir, exePath: w.exe, install: { execPath: w.exe, isSea: true } });
    await both.check(); const s = await both.download(); await both.verify(s); if (!s.verified) return 'rotated key not accepted'; } },
  { id: 'interrupted-swap-is-settled-at-next-start', async run(w) {
    writeFileSync(`${w.exe}.new`, program('9.9.9')); writeFileSync(`${w.exe}.previous.tmp`, 'x'); const r1 = await recoverInterrupted(w.exe, 'linux', nodeFs); if (r1 !== 'discarded' || existsSync(`${w.exe}.new`)) return `leftover .new: ${r1}`;
    writeFileSync(`${w.exe}.previous`, program('1.4.2')); rmSync(w.exe); const r2 = await recoverInterrupted(w.exe, 'linux', nodeFs); if (r2 !== 'restored' || (await runVersion(w.exe)) !== '1.4.2') return `not restored: ${r2}`; } },
  { id: 'no-update-while-a-session-is-live', async run(w) {
    w.channels.publish('stable', { version: '1.4.3', files: files('1.4.3') }); const c = w.client(); await c.check(); const s = await c.download(); await c.verify(s); const p = c.paths();
    const a = await applyUpdate({ exe: p.exe, staged: p.staged, from: '1.4.2', to: '1.4.3', platform: 'linux', sessionsLive: () => true }, nodeFs, nodeRunner); if (a.ok || a.code !== 'deferred') return 'applied during a session'; if ((await runVersion(w.exe)) !== '1.4.2') return 'program changed'; } },
  { id: 'production-trust-list-fails-closed', async run() { const k = trustedKeys(); if (k.keys.length !== 0 && k.keys.some((x) => Buffer.from(x.publicKey, 'base64url').length !== 32)) return 'malformed key slot trusted'; } },
];

export async function runUpdateScenarios(only?: string[]): Promise<ScenarioResult[]> {
  if (process.platform === 'win32') return [{ id: 'platform', ok: false, detail: 'the scenarios run real shell scripts and need a POSIX system' }];
  const out: ScenarioResult[] = [];
  for (const s of SCENARIOS) {
    if (only && !only.includes(s.id)) continue; const w = await world();
    try { const bad = await s.run(w); out.push(bad ? { id: s.id, ok: false, detail: bad } : { id: s.id, ok: true }); } catch (e) { out.push({ id: s.id, ok: false, detail: `threw: ${(e as Error).message.slice(0, 160)}` }); } finally { await w.close(); }
  }
  return out;
}
export const SCENARIO_IDS = SCENARIOS.map((s) => s.id);
void readFileSync;
