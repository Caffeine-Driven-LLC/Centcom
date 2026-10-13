/** Shared set-up for the end-to-end update tests: a mock release server with a signed channel, an install folder with a runnable "program", and the real `runUpdate` command. */
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UpdateClient, createHttpClient, type Channel } from '@centcom/net';
import { applyUpdate, nodeFs, nodeRunner } from '../../src/autoupdate/index.js';
import { runUpdate, type UpdateDeps, type UpdateIo } from '../../src/commands/update/index.js';
import { ReleaseChannels, makeTestSigner } from '../../../../tools/release-channels/channels.js';
import { startMockReleaseServer, type Fault, type MockReleaseServer } from '../../../../tools/release-channels/mock-server.js';
import { program } from '../../../../tools/release-channels/scenarios.js';

export interface Rig {
  dir: string; exe: string; channels: ReleaseChannels; server: MockReleaseServer; fault: { current: Fault }; publicKey: string; signerId: string;
  publish(channel: Channel, version: string, o?: { healthy?: boolean; minSupported?: string }): void;
  client(channel: Channel, o?: { isSea?: boolean; scriptPath?: string; keys?: { id: string; publicKey: string }[] }): UpdateClient;
  update(argv: string[], o?: { defaultChannel?: Channel; answer?: boolean; isSea?: boolean; scriptPath?: string; sessionsLive?: () => boolean }): Promise<{ code: number; out: string[]; err: string[]; asked: string[] }>;
  listing(): string[]; close(): Promise<void>;
}
export async function rig(o: { installed?: string; latencyMs?: number } = {}): Promise<Rig> {
  const installed = o.installed ?? '1.4.2'; const { signer, publicKey } = await makeTestSigner('rel-test'); const channels = new ReleaseChannels(signer); const fault = { current: 'none' as Fault };
  const server = await startMockReleaseServer({ channels, fault: () => fault.current, ...(o.latencyMs ? { latencyMs: o.latencyMs } : {}) });
  const dir = mkdtempSync(join(tmpdir(), 'cc-cli-upd-')); const exe = join(dir, 'centcom'); writeFileSync(exe, program(installed)); chmodSync(exe, 0o755);
  const http = createHttpClient({ baseUrl: server.url, getAccessToken: async () => undefined, userAgent: `centcom-cli/${installed} (contract/1.0.0; linux-x64; node/22.0.0)` });
  const client: Rig['client'] = (channel, c = {}) => new UpdateClient({ http, currentVersion: installed, platform: 'linux', arch: 'x64', channel, keys: { keys: c.keys ?? [{ id: signer.id, publicKey }] }, installDir: dir, exePath: exe, install: { execPath: exe, ...(c.scriptPath ? { scriptPath: c.scriptPath } : {}), isSea: c.isSea ?? true } });
  return { dir, exe, channels, server, fault, publicKey, signerId: signer.id, client,
    publish: (channel, version, p = {}) => { channels.publish(channel, { version, files: [{ platform: 'linux', arch: 'x64', body: program(version, p.healthy ?? true) }], ...(p.minSupported ? { minSupported: p.minSupported } : {}) }); },
    async update(argv, u = {}) {
      const out: string[] = []; const err: string[] = []; const asked: string[] = [];
      const io: UpdateIo = { out: (l) => out.push(l), err: (l) => err.push(l), confirm: async (q) => { asked.push(q); return u.answer ?? true; } };
      const deps: UpdateDeps = { version: installed, defaultChannel: u.defaultChannel ?? 'stable', client: (ch) => client(ch, { isSea: u.isSea ?? true, ...(u.scriptPath ? { scriptPath: u.scriptPath } : {}) }),
        applyStaged: (c, s) => { const p = c.paths(); return applyUpdate({ exe: p.exe, staged: p.staged, from: installed, to: s.version, platform: 'linux', ...(u.sessionsLive ? { sessionsLive: u.sessionsLive } : {}) }, nodeFs, nodeRunner); } };
      return { code: await runUpdate(argv, deps, io), out, err, asked };
    },
    listing: () => readdirSync(dir).sort(), close: async () => { await server.close(); rmSync(dir, { recursive: true, force: true }); } };
}
export const version = async (exe: string): Promise<string | undefined> => { const r = await nodeRunner.run(exe, ['--version', '--json'], { timeoutMs: 5000 }); try { return (JSON.parse(r.stdout) as { version?: string }).version; } catch { return undefined; } };
