import { afterEach, describe, expect, it } from 'vitest';
import { HostDuties, KeyRing, Roster, sodium } from '../../src/index.js';
import { WS, rig, until, virtualPeer } from './rig.js';

let r: Awaited<ReturnType<typeof rig>> | undefined;
afterEach(async () => { await r?.host.handle?.leave().catch(() => undefined); await r?.guest.handle?.leave().catch(() => undefined); await r?.stop(); r = undefined; });
describe('trust on first use (acceptance 7)', () => {
  it('a new device is remembered; when its keys change `key-changed` is raised and its frames are held until trustDevice()', async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const changes: { device: string }[] = []; const warns: string[] = []; h.on('key-changed', (c) => changes.push(c)); h.on('protocol-warning', (w) => warns.push(w.reason));
    const ring = new KeyRing(); ring.addEpoch('k5', sodium().crypto_aead_xchacha20poly1305_ietf_keygen()); const vp = await virtualPeer(r, h.id, 'Peer', ring, 'editor'); await new Promise((x) => setTimeout(x, 200)); await vp.grantTo(r.host, ['k5']);
    const got: string[] = []; h.on('message.user', (e) => got.push(String(e.secret?.text))); await until(() => h.heldEpochs().includes('k5')); vp.send('message.user', { secret: { text: 'first' } }); await until(() => got.includes('first')); expect(changes).toEqual([]); expect(h.roster().find((m) => m.id === vp.memberId)?.keyChanged).toBeFalsy();
    const k2 = await vp.rekey(); expect(k2.ed25519).not.toBe(vp.keys.ed25519); const third = await r.mk('Third', 'editor', 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V6Z').init(); const t = await third.client.joinSession({ sessionId: h.id }); third.handle = t; await until(() => changes.length === 1);
    expect(changes[0]!.device).toBe(vp.deviceId); expect(h.roster().find((m) => m.id === vp.memberId)?.keyChanged).toBe(true);
    vp.send('message.user', { secret: { text: 'held until trusted' } }); await until(() => warns.includes('untrusted_device')); await new Promise((x) => setTimeout(x, 200)); expect(got).toEqual(['first']);
    await h.trustDevice(vp.deviceId); await until(() => got.includes('held until trusted')); expect(h.roster().find((m) => m.id === vp.memberId)?.keyChanged).toBe(false); await t.leave();
  });
  it('trustDevice for a device that is not in the session is an error', async () => { r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; await expect(h.trustDevice('dev_01JA3Z8K2M5N7P9Q0R1S2T3V4W')).rejects.toMatchObject({ code: 'untrusted_device' }); });
  it('the host never gives a key to a device whose keys changed, is revoked, is a viewer or is itself', async () => {
    const ring = KeyRing.create(); const sent: unknown[] = []; const x25519 = 'A'.repeat(43); const duties = new HostDuties({ ring, deviceId: 'dev_self', policy: () => ({}), now: () => new Date(), recipients: () => [], sendGrant: async (p) => { sent.push(p); } });
    const keys = sodium().crypto_box_keypair(); const pk = Buffer.from(keys.publicKey).toString('base64url'); const base = { id: 'mem_a', role: 'editor' as const, slot: 1, device: 'dev_a', keys: { device: 'dev_a', x25519: pk, ed25519: x25519 } };
    expect(await duties.grantTo({ ...base, keyChanged: true })).toBe(false); expect(await duties.grantTo({ ...base, keys: { ...base.keys, revoked: true } })).toBe(false); expect(await duties.grantTo({ ...base, role: 'viewer' })).toBe(false); expect(await duties.grantTo({ ...base, device: 'dev_self' })).toBe(false); expect(await duties.grantTo({ ...base, keys: undefined })).toBe(false); expect(sent).toHaveLength(0);
    expect(await duties.grantTo(base)).toBe(true); expect(await duties.grantTo(base)).toBe(false); expect(sent).toHaveLength(1);
    const roster = new Roster(); roster.upsert(base); roster.upsert({ ...base, id: 'mem_b', device: 'dev_b', keyChanged: true, keys: { ...base.keys, device: 'dev_b' } }); expect(roster.recipients().map((m) => m.id)).toEqual(['mem_a']); expect(roster.recipients('dev_a')).toEqual([]);
  });
});
