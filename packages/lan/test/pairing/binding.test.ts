import { describe, expect, it } from 'vitest';
import { FingerprintMismatchError, guestPair, memoryChannelPair, SessionTrustStore, checkTrust } from '../../src/index.js';
import { deviceKeys, GUEST_DEV, HOST_DEV, SID, setup } from './helpers.js';

const flush = () => new Promise((r) => setImmediate(r));

describe('channel binding (acceptance 7)', () => {
  it('a MITM that relays but presents its own identity in lan.pair.2 makes confirmation fail on the host', async () => {
    const s = await setup(); const mitm = await deviceKeys('dev_01JA3Z8K2M5N7P9Q0R1S2T3V4M'); const mk = await mitm.d.getOrCreatePublicKeys();
    const [g, gm] = memoryChannelPair(); const [mh, h] = memoryChannelPair(); s.hp.attach(h, '10.0.0.66');
    gm.onMessage((t) => mh.send(t)); // guest -> host untouched
    mh.onMessage((t) => { const j = JSON.parse(t); if (j.t === 'lan.pair.2') { j.device = { id: 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4M', x25519: mk.x25519, ed25519: mk.ed25519, name: 'evil' }; j.fp = mitm.d.fingerprint(); } gm.send(JSON.stringify(j)); });
    mh.onClose((c) => gm.close(c));
    const p = guestPair({ channel: g, code: s.display, device: s.guest.d, deviceInfo: { id: GUEST_DEV, name: 'ana' }, hostSessionId: SID, expectedFingerprint: mitm.d.fingerprint(), clock: s.clock });
    await expect(p).rejects.toMatchObject({ pairReason: 'bad_code' }); await flush();
    expect(s.failed).toEqual([{ ip: '10.0.0.66', reason: 'bad_code' }]); expect(s.paired).toEqual([]);
  });
  it('a guest bound to a different session id never confirms against this host', async () => {
    const s = await setup(); const [g, h] = memoryChannelPair(); s.hp.attach(h, '10.0.0.67');
    const p = guestPair({ channel: g, code: s.display, device: s.guest.d, deviceInfo: { id: GUEST_DEV, name: 'ana' }, hostSessionId: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4Z', expectedFingerprint: s.host.d.fingerprint(), clock: s.clock });
    await expect(p).rejects.toMatchObject({ pairReason: 'bad_code' }); expect(s.paired).toEqual([]);
  });
  it('the mDNS fingerprint differing from the host fp rejects with FingerprintMismatchError before any confirmation is sent', async () => {
    const s = await setup(); const other = await deviceKeys('dev_01JA3Z8K2M5N7P9Q0R1S2T3V4O');
    const { p } = s.connect({ expectedFingerprint: other.d.fingerprint() });
    const e = await p.catch((x: unknown) => x); expect(e).toBeInstanceOf(FingerprintMismatchError);
    const fe = e as FingerprintMismatchError; expect(fe.expectedPrefix).toBe(`${other.d.fingerprint().slice(0, 4)}-…`); expect(fe.message).not.toContain(s.host.d.fingerprint());
    expect(s.guestSent.map((t) => JSON.parse(t).t)).toEqual(['lan.pair.1']);
  });
});

describe('trust on first use', () => {
  it('the host refuses a known device id that shows different keys and reports it; the old keys stay', async () => {
    const s = await setup(); const imposter = await deviceKeys(GUEST_DEV); const real = await s.guest.d.getOrCreatePublicKeys();
    s.trust.remember({ id: GUEST_DEV, ...real, name: 'ana', fingerprint: s.guest.d.fingerprint() });
    const changed: unknown[] = []; s.hp.on('trust_changed', (e) => changed.push(e));
    await expect(s.connect({ device: imposter.d, keychain: imposter.kc }).p).rejects.toBeTruthy();
    expect(changed).toEqual([{ deviceId: GUEST_DEV, fingerprintHint: `${imposter.d.fingerprint().slice(0, 4)}-…` }]);
    expect(s.trust.get(GUEST_DEV)?.x25519).toBe(real.x25519); expect(s.paired).toEqual([]);
  });
  it('the guest refuses a host whose keys changed for a known id', async () => {
    const s = await setup(); const trust = new SessionTrustStore(); trust.remember({ id: HOST_DEV, x25519: 'A'.repeat(43), ed25519: 'B'.repeat(43), name: 'old', fingerprint: 'AAAA-AAAA-AAAA' });
    const [g, h] = memoryChannelPair(); s.hp.attach(h, '10.0.0.70');
    const p = guestPair({ channel: g, code: s.display, device: s.guest.d, deviceInfo: { id: GUEST_DEV, name: 'ana' }, hostSessionId: SID, expectedFingerprint: s.host.d.fingerprint(), clock: s.clock, trust });
    await expect(p).rejects.toMatchObject({ pairReason: 'trust_changed' });
  });
  it('SessionTrustStore: new, match, changed; remember never overwrites; accept does; only public data is kept', () => {
    const t = new SessionTrustStore(2); const d = { id: 'dev_1', x25519: 'x', ed25519: 'e', name: 'n', fingerprint: 'f' };
    expect(checkTrust(t, d)).toBe('new'); t.remember({ ...d, secret: 'nope' } as typeof d); expect(t.get('dev_1')).toEqual(d); expect(checkTrust(t, d)).toBe('match');
    t.remember({ ...d, x25519: 'y' }); expect(checkTrust(t, { ...d, x25519: 'y' })).toBe('changed'); expect(t.get('dev_1')?.x25519).toBe('x');
    t.accept({ ...d, x25519: 'y' }); expect(t.get('dev_1')?.x25519).toBe('y');
    t.remember({ ...d, id: 'dev_2' }); t.remember({ ...d, id: 'dev_3' }); expect(t.get('dev_3')).toBeNull(); expect(t.list()).toHaveLength(2);
    t.forget('dev_2'); t.clear(); expect(t.list()).toEqual([]);
  });
});
