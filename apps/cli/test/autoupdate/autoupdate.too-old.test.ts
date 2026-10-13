import { CentcomError } from '@centcom/net';
import { afterEach, describe, expect, it } from 'vitest';
import { belowMinimum, isTooOldSignal, modeAllowed, tooOldScreen } from '../../src/autoupdate/index.js';
import { rig, type Rig } from './helpers.js';

let r: Rig | undefined; afterEach(async () => { await r?.close(); r = undefined; });
describe('client_too_old', () => {
  it('HTTP 426, the error code, the 4426 close code and a service minimum above ours are all "too old"; nothing else is', () => {
    expect([426, 4426].every(isTooOldSignal)).toBe(true); expect([200, 429, 1000, 4401].some(isTooOldSignal)).toBe(false);
    expect(isTooOldSignal(new CentcomError({ kind: 'api', code: 'client_too_old', status: 426 }))).toBe(true); expect(isTooOldSignal({ status: 426 })).toBe(true); expect(isTooOldSignal({ closeCode: 4426 })).toBe(true); expect(isTooOldSignal({ code: 4426 })).toBe(true);
    expect(isTooOldSignal(new Error('x', { cause: { status: 426 } }))).toBe(true); expect(isTooOldSignal(new CentcomError({ kind: 'api', code: 'forbidden', status: 403 }))).toBe(false); expect(isTooOldSignal(null)).toBe(false); expect(isTooOldSignal('426')).toBe(false); expect(isTooOldSignal(undefined)).toBe(false);
    expect(belowMinimum('1.1.0', { min_client_version: '1.2.0' })).toBe(true); expect(belowMinimum('1.2.0', { min_client_version: '1.2.0' })).toBe(false); expect(belowMinimum('1.2.0', {})).toBe(false); expect(belowMinimum('1.2.0', undefined)).toBe(false); expect(belowMinimum('1.2.0', { min_client_version: 5 })).toBe(false);
  });
  it('the blocking screen blocks hosted features only: LAN and local sessions still start', () => {
    expect(modeAllowed('hosted', true)).toBe(false); expect(modeAllowed('lan', true)).toBe(true); expect(modeAllowed('local', true)).toBe(true); expect(['hosted', 'lan', 'local'].every((m) => modeAllowed(m as never, false))).toBe(true);
    const s = tooOldScreen({ version: '1.1.0', min: '1.2.0', method: 'npm' }); expect(s.blocks).toEqual(['hosted']); expect(s.allows).toEqual(['lan', 'local']); expect(s.lines.join(' ')).toContain('npm i -g @centcom/cli@latest'); expect(s.lines.join(' ')).toContain('1.2.0'); expect(s.lines.join(' ')).toMatch(/LAN sessions still run/);
    expect(tooOldScreen({ version: '1.1.0', method: 'brew' }).lines.join(' ')).toContain('brew upgrade centcom'); expect(tooOldScreen({ version: '1.1.0', method: 'standalone' }).lines.join(' ')).toContain('centcom update'); expect(tooOldScreen({ version: '1.1.0', method: 'unknown' }).lines.join(' ')).toContain('source checkout');
  });
  it('a 426 from the real update client (mock server) is recognised, and a minimum above ours marks the check as required', async () => {
    r = await rig(); r.fault.current = 'too_old_426'; await expect(r.client('stable').check()).rejects.toSatisfy((e) => isTooOldSignal(e)); r.fault.current = 'none';
    r.publish('stable', '1.4.3', { minSupported: '1.4.3' }); expect((await r.client('stable').check()).required).toBe(true); const c = r.client('stable'); c.markRequired(); expect((await c.check()).required).toBe(true);
    const st = await (await fetch(`${r.server.url}/v1/status`)).json() as { min_client_version?: string }; expect(belowMinimum('1.4.2', st)).toBe(false);
  });
});
