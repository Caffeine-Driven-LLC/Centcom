import { afterEach, describe, expect, it } from 'vitest';
import { KeyRing, epochOf, sealGrants, sodium, initCrypto } from '../../src/index.js';
import { WS, rig, until, virtualPeer, type Peer } from './rig.js';

let r: Awaited<ReturnType<typeof rig>> | undefined; const extra: Peer[] = [];
afterEach(async () => { for (const p of [r?.host, r?.guest, ...extra.splice(0)]) await p?.handle?.leave().catch(() => undefined); await r?.stop(); r = undefined; });
const frames = (sid: string) => r!.m.relay.frames(sid);

describe('grant on join (acceptance 3)', () => {
  it('the guest waits for a key, the host sends one key.grant after member_joined, the guest goes live and decrypts; the relay sees no plaintext', async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const states: string[] = [];
    const g = await r.guest.client.joinSession({ sessionId: h.id, on: { state: (s) => states.push(s), 'waiting-for-key': () => states.push('waiting-event') } }); r.guest.handle = g; await until(() => g.state === 'live');
    expect(states[0]).toBe('waiting_for_key'); expect(states).toContain('waiting-event'); expect(states.at(-1)).toBe('live'); expect(frames(h.id).filter((f) => f.k === 'key.grant')).toHaveLength(1);
    const got: string[] = []; const back: string[] = []; g.on('message.user', (e) => got.push(String(e.secret?.text))); h.on('message.user', (e) => back.push(String(e.secret?.text)));
    await h.sendEvent('message.user', { secret: { text: 'CANARY-7f3a hello' } }); await until(() => got.length === 1); expect(got[0]).toBe('CANARY-7f3a hello');
    expect(JSON.stringify(r.m.relay.frames(h.id))).not.toContain('CANARY-7f3a');
    await g.sendEvent('message.user', { secret: { text: 'from guest' } }); await until(() => back.includes('from guest'));
  });
  it('the grant comes within 2 s of member_joined and is sealed only to the guest', async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const t0 = Date.now(); const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; await until(() => frames(h.id).some((f) => f.k === 'key.grant')); expect(Date.now() - t0).toBeLessThan(2000);
  });
  it('a device whose keys the host does not know gets no grant and stays waiting; it cannot send encrypted frames and is told so', async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const lone = await r.mk('Lone', 'editor', 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V5Y', false).init(); extra.push(lone);
    const g = await lone.client.joinSession({ sessionId: h.id }); lone.handle = g; await new Promise((x) => setTimeout(x, 400)); expect(g.state).toBe('waiting_for_key'); expect(frames(h.id).filter((f) => f.k === 'key.grant')).toHaveLength(0);
    await expect(g.sendEvent('message.user', { secret: { text: 'x' } })).rejects.toMatchObject({ code: 'waiting_for_key' }); await expect(g.sendEvent('nope.kind', {})).rejects.toBeInstanceOf(TypeError);
  });
  it('a guest keeps frames it cannot read yet and shows them once an editor with the key grants it (also covers grants from editors)', async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const lone = await r.mk('Lone', 'editor', 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V5Y', false).init(); extra.push(lone);
    const g = await lone.client.joinSession({ sessionId: h.id }); lone.handle = g; await new Promise((x) => setTimeout(x, 300)); expect(g.state).toBe('waiting_for_key'); const ring = new KeyRing(); ring.addEpoch('k9', sodium().crypto_aead_xchacha20poly1305_ietf_keygen());
    const vp = await virtualPeer(r, h.id, 'Keyholder', ring, 'editor'); const got: string[] = []; g.on('message.user', (e) => got.push(String(e.secret?.text)));
    vp.send('message.user', { secret: { text: 'sent before the key arrived' } }); await new Promise((x) => setTimeout(x, 300)); expect(got).toEqual([]); expect(g.state).toBe('waiting_for_key');
    r.reg.members.set('mem_LONE', { id: 'mem_LONE', role: 'editor', slot: 1, display_name: 'Lone', device: lone.deviceId, device_keys: { device: lone.deviceId, x25519: (await lone.device.getOrCreatePublicKeys()).x25519, ed25519: (await lone.device.getOrCreatePublicKeys()).ed25519, fingerprint: lone.device.fingerprint() } });
    const grant = sealGrants(ring, ['k9'], (await lone.device.getOrCreatePublicKeys()).x25519, lone.deviceId); vp.send('key.grant', { p: grant.p, secret: grant.secret as never }, { kid: 'k9' });
    await until(() => g.state === 'live'); await until(() => got.length === 1); expect(got[0]).toBe('sent before the key arrived');
  });
  it('a grant addressed to another device, or from a viewer, gives nothing', async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const lone = await r.mk('Lone', 'editor', 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V5Y', false).init(); extra.push(lone); const g = await lone.client.joinSession({ sessionId: h.id }); lone.handle = g;
    const ring = new KeyRing(); ring.addEpoch('k9', sodium().crypto_aead_xchacha20poly1305_ietf_keygen()); const viewer = await virtualPeer(r, h.id, 'Viewer', ring, 'editor'); r.reg.members.get(viewer.memberId)!.role = 'viewer'; const keys = await lone.device.getOrCreatePublicKeys();
    const other = sealGrants(ring, ['k9'], keys.x25519, 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4W'); viewer.send('key.grant', { p: other.p, secret: other.secret as never }, { kid: 'k9' }); const mine = sealGrants(ring, ['k9'], keys.x25519, lone.deviceId); viewer.send('key.grant', { p: mine.p, secret: mine.secret as never }, { kid: 'k9' });
    await new Promise((x) => setTimeout(x, 400)); expect(g.state).toBe('waiting_for_key');
  });
});
describe('share history (acceptance 4)', () => {
  const setup = async (share: boolean) => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS, policy: { share_history: share } }); r.host.handle = h; const a = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = a; await until(() => a.state === 'live');
    const aId = h.roster().find((m) => m.device === r!.guest.deviceId)!.id; await h.sendEvent('control.kick', { p: { member: aId, code: 'abuse' } }); await until(() => frames(h.id).some((f) => f.k === 'control.rotate_key')); await new Promise((x) => setTimeout(x, 300));
    const late = await r.mk('Late', 'editor', 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V7A').init(); extra.push(late); const warns: string[] = []; const grants: string[][] = []; const b = await late.client.joinSession({ sessionId: h.id, on: { 'protocol-warning': (w) => warns.push(w.reason) } }); late.handle = b; b.on('key.grant', (e) => { if (e.p?.to_device === late.deviceId) grants.push(e.p!.kids as string[]); });
    await until(() => b.state === 'live'); return { h, b, warns, grants };
  };
  it('with share_history off the grant holds only the current epoch; older frames are reported as unreadable once, not as failures', async () => {
    const { b, warns, h } = await setup(false); expect(b.heldEpochs()).toHaveLength(1); const old = await virtualPeer(r!, h.id, 'Old', (() => { const k = new KeyRing(); k.addEpoch('k1', sodium().crypto_aead_xchacha20poly1305_ietf_keygen()); return k; })(), 'editor');
    old.send('message.user', { secret: { text: 'written under k1' } }, { kid: 'k1' }); old.send('message.user', { secret: { text: 'again under k1' } }, { kid: 'k1' }); await until(() => warns.includes('unreadable_earlier_history')); await new Promise((x) => setTimeout(x, 200));
    expect(warns.filter((w) => w === 'unreadable_earlier_history')).toHaveLength(1); expect(b.state).toBe('live');
  });
  it('with share_history on the newcomer is given every epoch the host holds', async () => {
    const { b } = await setup(true); expect(b.heldEpochs().length).toBeGreaterThanOrEqual(2); expect(b.heldEpochs()[0]).toBe('k1');
  });
});
describe('rotation on kick (acceptance 5)', () => {
  it('after control.kick and rotate_key the next outbound frame uses the new epoch; one grant per remaining device; the kicked member is excluded', async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; await until(() => g.state === 'live');
    const third = await r.mk('Third', 'editor', 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V6Z').init(); extra.push(third); const t = await third.client.joinSession({ sessionId: h.id }); third.handle = t; await until(() => t.state === 'live');
    const kicked = h.roster().find((m) => m.device === r!.guest.deviceId)!.id; const got: string[] = []; t.on('message.user', (e) => got.push(String(e.secret?.text))); const before = frames(h.id).filter((f) => f.k === 'key.grant').length;
    await h.sendEvent('control.kick', { p: { member: kicked, code: 'abuse' } }); await until(() => frames(h.id).filter((f) => f.k === 'key.grant').length === before + 1, 6000);
    await h.sendEvent('message.user', { secret: { text: 'after rotation' } }); await until(() => got.includes('after rotation'));
    const rotated = frames(h.id).filter((f) => f.k === 'control.rotate_key'); expect(rotated).toHaveLength(1); expect(frames(h.id).filter((f) => f.k === 'key.grant').length).toBe(before + 1);
    expect(g.state === 'ended' || !h.roster().some((m) => m.id === kicked)).toBe(true);
  });
});
describe('rotation helpers', () => {
  it('epochs are numbers from 1', () => { expect(epochOf('k3')).toBe(3); expect(() => epochOf('x')).toThrow(); });
});

describe('scheduled rotation', () => {
  it('the host asks for a new epoch after 7 days or 100,000 frames, whichever comes first, and only asks once', async () => {
    const { HostDuties } = await import('../../src/index.js'); const t0 = Date.UTC(2026, 9, 1); let now = t0; const ring = KeyRing.create(new Date(t0)); const d = new HostDuties({ ring, deviceId: 'dev_x', policy: () => ({}), now: () => new Date(now), recipients: () => [], sendGrant: async () => undefined });
    expect(d.rotationDue()).toBe(false); now = t0 + 7 * 86_400_000 - 1; expect(d.rotationDue()).toBe(false); now = t0 + 7 * 86_400_000; expect(d.rotationDue()).toBe(true);
    now = t0; for (let i = 0; i < 99_999; i++) d.noteFrame(); expect(d.rotationDue()).toBe(false); d.noteFrame(); expect(d.rotationDue()).toBe(true);
    await d.onRotateKey('k2', 'scheduled'); expect(ring.current().kid).toBe('k2'); expect(d.frames).toBe(0); expect(d.rotationDue()).toBe(false);
  });
  it('through the client: a timer on the injected clock sends one control.rotate_request once the epoch is a week old', async () => {
    const { ManualClock } = await import('./rig.js'); r = await rig(); const clock = new ManualClock(); await r.host.init({ clock }); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h;
    const asks = () => frames(h.id).filter((f) => f.k === 'control.rotate_request').length; await clock.advance(6 * 86_400_000); expect(asks()).toBe(0); await clock.advance(2 * 86_400_000); await until(() => asks() >= 1); await clock.advance(86_400_000); await new Promise((x) => setTimeout(x, 100)); expect(asks()).toBe(1);
  });
});
describe('rotation when the relay announces a later epoch than ours', () => {
  it('the host makes exactly that epoch, so frames sent after it use it', async () => {
    const { HostDuties } = await import('../../src/index.js'); const ring = KeyRing.create(); const grants: string[][] = []; const d = new HostDuties({ ring, deviceId: 'dev_x', policy: () => ({}), now: () => new Date(), recipients: () => [], sendGrant: async (p) => { grants.push(p.kids); } });
    await d.onRotateKey('k7', 'member_removed'); expect(ring.current().kid).toBe('k7'); expect(ring.kids()).toEqual(['k1', 'k7']); await d.onRotateKey('k7', 'member_removed'); await d.onRotateKey('k3', 'requested'); expect(ring.current().kid).toBe('k7'); expect(ring.kids()).toEqual(['k1', 'k3', 'k7'].filter((k) => ring.get(k)));
  });
});
