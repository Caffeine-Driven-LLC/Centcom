import { describe, expect, it } from 'vitest';
import { DeviceKeyStore, FrameCodec, KeyRing, Roster, initCrypto, memoryKeychain, sodium } from '@centcom/net';
import { GuestSession, LanTransport, codecDecoder, type SequencedFrame } from '../../src/index.js';
import { CLIENT, SID, dev, mem, token } from '../rigs.js';
import { cleanup, nextId, onStop, que, realClock, setup, wait } from './rig.js';

cleanup();

/** A guest on the real path: the session client's codec seals and signs what it submits, a host with the same session key opens it and checks who signed it. */
describe('queue submit on the real session path (C076)', () => {
  it('a GuestSession submit is sealed under the session key and signed by the device key; the host opens it and the signature checks out; the clear part holds no text', async () => {
    await initCrypto(); const r = await setup({ policy: { auto_approve: 'ask' } }); const kc = memoryKeychain(); const device = new DeviceKeyStore(kc, dev(2)); const keys = await device.getOrCreatePublicKeys();
    const ring = new KeyRing(); ring.addEpoch('k1', sodium().crypto_aead_xchacha20poly1305_ietf_keygen()); const roster = new Roster(); roster.upsert({ id: mem(2), role: 'editor', slot: 1, device: dev(2), keys: { device: dev(2), ...keys } } as never);
    const guestCodec = new FrameCodec({ sid: SID, deviceId: dev(2), device, ring, roster }); const hostCodec = new FrameCodec({ sid: SID, deviceId: dev(1), device: undefined, ring, roster });
    const t = new LanTransport({ host: '127.0.0.1', port: r.env.port, sessionId: SID, reconnectToken: token('g1'), keychain: kc, device, deviceInfo: { id: dev(2), name: 'g1' }, clientInfo: CLIENT, getLastSeq: () => null });
    const g = await GuestSession.join({ transport: t, decoder: codecDecoder(guestCodec), clock: realClock, ids: { msg: nextId, que: () => que('G1') }, encoder: guestCodec, sid: SID }); onStop(() => g.leave());
    await wait(() => g.state.roster.length > 0 && g.state.me.role === 'editor');
    const item = await g.submit('rename the module and run the tests'); await wait(() => r.engine.queue().items.length === 1);
    expect((r.engine.queue().items[0] as { item: string; submitter: string }).item).toBe(item);
    let stored: SequencedFrame | undefined;
    for (let n = 0; n < 40 && !stored; n++) { for await (const f of r.persistence.readFrames(SID, 0, 1000)) if (f.k === 'queue.submit') stored = f; if (!stored) await new Promise((res) => setTimeout(res, 25)); }
    expect(stored).toBeDefined(); const f = stored!; expect(JSON.stringify(f)).not.toContain('rename the module'); expect(f.ct).toBeDefined(); expect(f.sig).toBeDefined(); expect((f.p as { size: number }).size).toBe(Math.floor((f.ct!.c.length * 3) / 4));
    const d = hostCodec.decode(f as never); expect(d.ok).toBe(true); expect(d.ok && (d.event.secret as { body: string }).body).toBe('rename the module and run the tests');
    const forged = { ...f, from: mem(2), sig: 'A'.repeat(f.sig!.length) }; const bad = hostCodec.decode(forged as never); expect(bad.ok).toBe(false); expect(!bad.ok && bad.reason).toBe('bad_signature');
  });
  it('a guest without a device key (a view-only link) cannot submit: the codec refuses before anything is sent', async () => {
    await initCrypto(); const ring = new KeyRing(); ring.addEpoch('k1', sodium().crypto_aead_xchacha20poly1305_ietf_keygen()); const codec = new FrameCodec({ sid: SID, deviceId: dev(2), device: undefined, ring, roster: new Roster() });
    expect(() => codec.encode('queue.submit', nextId(), { p: ({ ctBytes }) => ({ item: que('V'), size: ctBytes, kind: 'message' }), secret: { body: 'x' } })).toThrow(/view-only/);
  });
});
