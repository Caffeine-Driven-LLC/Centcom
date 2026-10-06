/** `centcom telemetry status|on|off|reset`, and the client the app uses. Off unless you turn it on; DO_NOT_TRACK=1 or CENTCOM_TELEMETRY=off always win. What can be sent: docs/telemetry.md. */
import { randomBytes } from 'node:crypto';
import { arch, platform } from 'node:os';
import { join } from 'node:path';
import { defaultDeps, loadConfig, stateDir, writeUserConfig, type LoadDeps } from '@centcom/config';
import { createTelemetry, fetchPost, nodeStateFs, telemetryEnabled, type Telemetry } from '@centcom/net';
import { CONTRACT_VERSION } from '@centcom/protocol';

export const CLI_COMMANDS = new Set(['tui', 'print', 'provider', 'mcp', 'hooks', 'memory', 'telemetry', 'init', 'rewind', 'fleet']);
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ulid = () => { let t = Date.now(); let time = ''; for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32] + time; t = Math.floor(t / 32); } const r = randomBytes(16); let rand = ''; for (let i = 0; i < 16; i++) rand += CROCKFORD[r[i]! % 32]; return time + rand; };

export function makeTelemetry(o: { enabled: boolean; baseUrl: string; version: string; env?: NodeJS.ProcessEnv; deps?: Pick<LoadDeps, 'env' | 'homedir'> }): Telemetry {
  const env = o.env ?? process.env; const d = o.deps ?? defaultDeps();
  return createTelemetry({ config: () => ({ enabled: o.enabled }), env: env as Record<string, string | undefined>, clock: { now: () => Date.now(), monotonic: () => performance.now(), setTimeout: (f: () => void, ms: number) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, clearTimeout: (h: never) => clearTimeout(h) } as never,
    fs: nodeStateFs, http: fetchPost, ulid, ua: `centcom/${o.version}`, baseUrl: o.baseUrl, installIdPath: join(stateDir(d), 'telemetry', 'install_id'), app: { name: 'centcom', version: o.version, os: platform(), arch: arch(), contract: CONTRACT_VERSION }, commands: CLI_COMMANDS });
}
export interface TelemetryIO { out(l: string): void; err(l: string): void; deps?: LoadDeps; version: string }
export async function runTelemetry(argv: string[], io: TelemetryIO): Promise<number> {
  const deps = io.deps ?? defaultDeps(); const cfg = await loadConfig(deps); const sub = argv[0] ?? 'status';
  const envOff = deps.env.DO_NOT_TRACK === '1' || deps.env.DO_NOT_TRACK === 'true' || deps.env.CENTCOM_TELEMETRY === 'off';
  switch (sub) {
    case 'status': { const on = telemetryEnabled({ enabled: cfg.telemetry.enabled }, deps.env as never); io.out(`Telemetry is ${on ? 'on' : 'off'}${envOff ? ' (DO_NOT_TRACK or CENTCOM_TELEMETRY in your environment turns it off, whatever the setting)' : ''}.`); io.out('Only anonymous counts are ever sent: which commands and features are used, errors by code, and timings. Never code, prompts, paths, names or keys. See docs/telemetry.md.'); return 0; }
    case 'on': case 'off': writeUserConfig(deps, { telemetry: { enabled: sub === 'on' } }); io.out(sub === 'on' ? `Telemetry is on. Thank you.${envOff ? ' (Your environment still turns it off: DO_NOT_TRACK or CENTCOM_TELEMETRY.)' : ''}` : 'Telemetry is off. Nothing is recorded or sent.'); return 0;
    case 'reset': { await makeTelemetry({ enabled: true, baseUrl: cfg.api.base_url, version: io.version, deps }).resetInstallId(); io.out('A new random install id will be used from now on; the old one is deleted.'); return 0; }
    default: io.err('Usage: centcom telemetry status|on|off|reset'); return 2;
  }
}
