import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultDeps } from '@centcom/config';
import { runTelemetry } from '../src/commands/telemetry.js';

const dirs: string[] = []; afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
function io(env: Record<string, string> = {}) { const home = mkdtempSync(join(tmpdir(), 'centcom-tm-')); dirs.push(home); const out: string[] = []; const err: string[] = []; const deps = defaultDeps({ homedir: home, env: { XDG_CONFIG_HOME: join(home, 'cfg'), CENTCOM_STATE_DIR: join(home, 'state'), ...env }, platform: 'linux' }); return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l), deps, version: 't' }, out, err, home }; }
describe('centcom telemetry', () => {
  it('is off by default; on writes the user setting; off turns it back off', async () => { const t = io(); await runTelemetry(['status'], t.io); expect(t.out[0]).toBe('Telemetry is off.'); expect(await runTelemetry(['on'], t.io)).toBe(0); expect(JSON.parse(readFileSync(join(t.home, 'cfg/centcom/config.json'), 'utf8')).telemetry.enabled).toBe(true); t.out.length = 0; await runTelemetry(['status'], t.io); expect(t.out[0]).toBe('Telemetry is on.'); await runTelemetry(['off'], t.io); t.out.length = 0; await runTelemetry(['status'], t.io); expect(t.out[0]).toBe('Telemetry is off.'); });
  it('DO_NOT_TRACK and CENTCOM_TELEMETRY=off always win and status says why', async () => { for (const env of [{ DO_NOT_TRACK: '1' }, { CENTCOM_TELEMETRY: 'off' }] as Record<string, string>[]) { const t = io(env); await runTelemetry(['on'], t.io); expect(t.out[0]).toMatch(/still turns it off/); t.out.length = 0; await runTelemetry(['status'], t.io); expect(t.out[0]).toMatch(/^Telemetry is off \(DO_NOT_TRACK or CENTCOM_TELEMETRY/); } });
  it('reset makes a new install id; usage errors', async () => { const t = io(); expect(await runTelemetry(['reset'], t.io)).toBe(0); expect(t.out[0]).toMatch(/new random install id/); expect(await runTelemetry(['bogus'], t.io)).toBe(2); });
});
