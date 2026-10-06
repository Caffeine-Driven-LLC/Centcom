import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { payloadMode } from '@centcom/protocol';
import { DeviceKeyStore, FrameCodec, KeyRing, Roster, SERVER_ONLY, frameTypeOf, initCrypto, memoryKeychain, sodium, type SequencedFrame } from '../../src/index.js';
import { WS, rig, until, virtualPeer } from './rig.js';

const DIR = join(import.meta.dirname, '../../../../contracts/fixtures/events');
const fixtures = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as { kind: string; frame: Record<string, unknown>; secret?: Record<string, unknown>; secret_payload?: Record<string, unknown> });
const SID = 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W'; const ID = 'msg_01JA3Z8K2M5N7P9Q0R1S2T3V4W'; const MEM = 'mem_01JA3Z8K2M5N7P9Q0R1S2T3V4W'; const DEV = 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4W';

describe('every fixture goes through encode and decode unchanged (codec level)', () => {
  it('found the corpus', () => { expect(fixtures.length).toBeGreaterThanOrEqual(45); });
  for (const fx of fixtures) {
    it(fx.kind, async () => {
      await initCrypto(); const device = new DeviceKeyStore(memoryKeychain(), DEV); const keys = await device.getOrCreatePublicKeys(); const ring = new KeyRing(); ring.addEpoch('k1', sodium().crypto_aead_xchacha20poly1305_ietf_keygen());
      const roster = new Roster(); roster.upsert({ id: MEM, role: 'editor', slot: 1, device: DEV, keys: { device: DEV, ...keys } }); const codec = new FrameCodec({ sid: SID, deviceId: DEV, device, ring, roster });
      const secret = (fx.secret ?? fx.secret_payload) as Record<string, unknown> | undefined; const p = (fx.kind === 'key.grant' ? { ...(fx.frame.p as object), kids: ['k1'] } : fx.frame.p) as Record<string, unknown> | undefined; /* the fixture's placeholder kid is not a key id */ const out = codec.encode(fx.kind, ID, { p, secret });
      expect(out.t).toBe(frameTypeOf(fx.kind)); const mode = payloadMode(fx.kind); if (mode === 'clear') { expect(out.ct).toBeUndefined(); expect(out.sig).toBeUndefined(); } else { expect(out.ct?.kid).toBe('k1'); expect(out.sig).toBeTruthy(); expect(JSON.stringify(out)).not.toContain(JSON.stringify(secret ?? {}).slice(1, 20)); }
      if (mode === 'encrypted') expect(out.p).toBeUndefined(); if (mode === 'hybrid') expect(out.p).toEqual(p);
      const frame = { v: 1, sid: SID, from: MEM, ts: '2026-10-05T18:07:41.123Z', seq: 7, ...out } as unknown as SequencedFrame; const back = codec.decode(frame);
      expect(back.ok, JSON.stringify(back)).toBe(true); if (!back.ok) return; expect(back.event.kind).toBe(fx.kind); expect(back.event.verified).toBe(true); if (mode !== 'encrypted') expect(back.event.p).toEqual(p); if (mode !== 'clear') expect(back.event.secret).toEqual(secret);
    });
  }
});
describe('through the relay (acceptance 3 and the decode test of the card)', () => {
  let r: Awaited<ReturnType<typeof rig>> | undefined; afterEach(async () => { await r?.host.handle?.leave().catch(() => undefined); await r?.guest.handle?.leave().catch(() => undefined); await r?.stop(); r = undefined; });
  const relayed = fixtures.filter((f) => !f.kind.startsWith('control.') && !f.kind.startsWith('queue.') && !f.kind.startsWith('presence.') && f.kind !== 'key.grant' && !SERVER_ONLY.has(f.kind));
  it(`${relayed.length} event kinds reach the guest with matching p and secret, and the relay's log holds none of the secret text`, async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; await until(() => g.state === 'live');
    const ring = new KeyRing(); ring.addEpoch('k5', sodium().crypto_aead_xchacha20poly1305_ietf_keygen()); const vp = await virtualPeer(r, h.id, 'Sender', ring, 'editor'); await new Promise((x) => setTimeout(x, 100)); await vp.grantTo(r.guest, ['k5']); await new Promise((x) => setTimeout(x, 200));
    const got = new Map<string, { p?: unknown; secret?: unknown }>(); g.onAny((e) => got.set(e.kind, { p: e.p, secret: e.secret })); const warns: string[] = []; g.on('protocol-warning', (w) => warns.push(w.reason));
    for (const fx of relayed) vp.send(fx.kind, { p: fx.frame.p as never, secret: (fx.secret ?? fx.secret_payload) as never });
    await until(() => relayed.every((f) => got.has(f.kind)), 8000); expect(warns).toEqual([]);
    for (const fx of relayed) { const mode = payloadMode(fx.kind); const e = got.get(fx.kind)!; if (mode !== 'encrypted') expect(e.p, fx.kind).toEqual(fx.frame.p); if (mode !== 'clear') expect(e.secret, fx.kind).toEqual(fx.secret ?? fx.secret_payload); }
    expect(JSON.stringify(r.m.relay.frames(h.id))).not.toContain('"text"');
  });
});
