import { afterEach, describe, expect, it } from 'vitest';
import { rig, version, type Rig } from './helpers.js';

const win = process.platform === 'win32'; let r: Rig | undefined; afterEach(async () => { await r?.close(); r = undefined; });
describe.skipIf(win)('centcom update against a signed channel (mock release server)', () => {
  it('--check: 1.4.3 on stable and 1.4.2 installed exits 10 within 2 s and prints version and channel; equal version exits 0', async () => {
    r = await rig(); r.publish('stable', '1.4.3'); const t0 = Date.now(); const a = await r.update(['--check']); expect(Date.now() - t0).toBeLessThan(2000); expect(a.code).toBe(10); expect(a.out.join(' ')).toMatch(/1\.4\.3.*stable/); expect(r.listing()).toEqual(['centcom']);
    const j = await r.update(['--check', '--json']); expect(JSON.parse(j.out[0]!)).toMatchObject({ available: true, version: '1.4.3', channel: 'stable' });
    r.channels.yank('stable'); r.publish('stable', '1.4.2'); const b = await r.update(['--check']); expect(b.code).toBe(0); expect(b.out.join(' ')).toContain('up to date');
  });
  it('a full update: confirmed, downloaded, verified, swapped, healthy; the old program is kept as .previous and nothing else is left', async () => {
    r = await rig(); r.publish('stable', '1.4.3'); const u = await r.update([]); expect(u.code).toBe(0); expect(u.asked).toHaveLength(1); expect(u.out.join(' ')).toContain('Updated to 1.4.3'); expect(await version(r.exe)).toBe('1.4.3'); expect(await version(`${r.exe}.previous`)).toBe('1.4.2'); expect(r.listing()).toEqual(['centcom', 'centcom.previous']);
  });
  it('a tampered artifact (one byte changed) exits 11, the old program stays, and no partial file remains in the install folder', async () => {
    r = await rig(); r.publish('stable', '1.4.3'); r.fault.current = 'tamper'; const u = await r.update(['--yes']); expect(u.code).toBe(11); expect(u.err.join(' ')).toMatch(/checksum differs|nothing was changed/); expect(await version(r.exe)).toBe('1.4.2'); expect(r.listing()).toEqual(['centcom']);
  });
  it('a bad signature, an unknown key id and a key we do not trust all exit 11 and change nothing', async () => {
    r = await rig(); r.publish('stable', '1.4.3');
    for (const f of ['bad_signature', 'unknown_kid'] as const) { r.fault.current = f; const u = await r.update(['--yes']); expect(u.code, f).toBe(11); expect(r.listing(), f).toEqual(['centcom']); expect(await version(r.exe)).toBe('1.4.2'); }
    r.fault.current = 'none'; const { makeTestSigner } = await import('../../../../tools/release-channels/channels.js'); const other = await makeTestSigner('rel-test'); const rr = r; const c = rr.client('stable', { keys: [{ id: 'rel-test', publicKey: other.publicKey }] }); await c.check(); const s = await c.download(); await expect(c.verify(s)).rejects.toMatchObject({ code: 'bad_signature' }); expect(rr.listing()).toEqual(['centcom']);
  });
  it('a new program that fails its health check is rolled back: exit 1, the old version reports itself, a .previous copy is kept', async () => {
    r = await rig(); r.publish('stable', '1.4.3', { healthy: false }); const u = await r.update(['--yes']); expect(u.code).toBe(1); expect(u.out.join(' ')).toMatch(/did not start, so the old one was put back/); expect(await version(r.exe)).toBe('1.4.2'); expect(r.listing()).toEqual(['centcom', 'centcom.previous']);
  });
  it('a channel that only has an older release is refused as a downgrade unless --allow-downgrade, which asks first', async () => {
    r = await rig({ installed: '1.5.0' }); r.publish('stable', '1.4.9'); const a = await r.update(['--check']); expect(a.code).toBe(1); expect(a.out.join(' ')).toMatch(/older than yours.*--allow-downgrade/); expect(r.listing()).toEqual(['centcom']);
    const no = await r.update(['--allow-downgrade'], { answer: false }); expect(no.code).toBe(1); expect(no.asked[0]).toMatch(/Go back from 1\.5\.0 to 1\.4\.9/); expect(await version(r.exe)).toBe('1.5.0');
    const yes = await r.update(['--allow-downgrade', '--yes']); expect(yes.code).toBe(0); expect(await version(r.exe)).toBe('1.4.9');
  });
  it('a replayed old manifest (an attacker serving an earlier release) is not offered', async () => {
    r = await rig(); r.publish('stable', '1.4.0'); r.publish('stable', '1.4.3'); r.fault.current = 'replay_old'; const a = await r.update(['--yes']); expect(a.code).toBe(1); expect(a.out.join(' ')).toContain('older than yours'); expect(await version(r.exe)).toBe('1.4.2');
  });
  it('--rollback puts the kept version back', async () => {
    r = await rig(); r.publish('stable', '1.4.3'); await r.update(['--yes']); expect(await version(r.exe)).toBe('1.4.3'); const b = await r.update(['--rollback']); expect(b.code).toBe(0); expect(await version(r.exe)).toBe('1.4.2'); expect((await r.update(['--rollback'])).code).toBe(1);
  });
});
