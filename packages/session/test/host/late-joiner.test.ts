import { describe, expect, it } from 'vitest';
import { DeviceKeyStore, FrameCodec, KeyRing, Roster, initCrypto, memoryKeychain, sodium } from '@centcom/net';
import type { Frame } from '@centcom/protocol';
import { GuestSession, LanTransport, codecDecoder, initialGuestState, lanSnapshotBuilder, openLanSnapshot, reduceGuestState, type GuestState } from '../../src/index.js';
import { CLIENT, SID, dev, mem, token } from '../rigs.js';
import { cleanup, nextId, onStop, realClock, setup, wait } from './rig.js';

cleanup();
const AGENT = 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V4W';

/**
 * A host with real keys: it seals what it says, follows its own conversation through its loopback link (the host UI's job) and builds the snapshot
 * from that view. The LAN replay window is 12 frames, so a guest that is far behind cannot be caught up by replay and needs the snapshot.
 */
async function world(o: { snapshots?: boolean } = {}) {
  await initCrypto();
  const hostDev = new DeviceKeyStore(memoryKeychain(), dev(1)); const hostKeys = await hostDev.getOrCreatePublicKeys(); const ring = new KeyRing(); const key = sodium().crypto_aead_xchacha20poly1305_ietf_keygen(); ring.addEpoch('k1', key);
  const roster = new Roster(); roster.upsert({ id: mem(1), role: 'host', slot: 0, device: dev(1), keys: { device: dev(1), ...hostKeys } } as never);
  const hostCodec = new FrameCodec({ sid: SID, deviceId: dev(1), device: hostDev, ring, roster });
  let view: GuestState = initialGuestState({ member: mem(1), slot: 0, role: 'host' }); let eng: { queue(): never; members(): never } | undefined;
  const builder = lanSnapshotBuilder({ sid: SID, ring, engine: { queue: () => eng!.queue(), members: () => eng!.members() } as never, view: () => view });
  const r = await setup({ server: { replayMinFrames: 12, replayMinMs: 0 }, engine: o.snapshots === false ? { snapshotBuilder: undefined } : { snapshotBuilder: builder } }); eng = r.engine as never;
  const link = r.engine.hostLink() as unknown as { send(f: never): Promise<void>; on(ev: 'frame', fn: (f: Frame) => void): () => void }; link.on('frame', (f: Frame) => { const d = hostCodec.decode(f as never); if (d.ok) view = reduceGuestState(view, { ...f, k: d.event.kind, ...(d.event.p !== undefined ? { p: d.event.p } : {}), secret: d.event.secret ?? null } as never); } );
  const say = async (text: string): Promise<void> => { const n = view.transcript.length; await link.send(hostCodec.encode('message.user', nextId(), { secret: { text, agent_id: AGENT } }) as never); await wait(() => view.transcript.length === n + 1); };
  /** a guest that is far behind: its hello says it last saw seq 2 */
  const lateGuest = async (withKey: boolean) => {
    const gRing = new KeyRing(); if (withKey) gRing.addEpoch('k1', key); const kc = memoryKeychain(); const device = new DeviceKeyStore(kc, dev(3)); await device.getOrCreatePublicKeys();
    const t = new LanTransport({ host: '127.0.0.1', port: r.env.port, sessionId: SID, reconnectToken: token('g2'), keychain: kc, device, deviceInfo: { id: dev(3), name: 'g2' }, clientInfo: CLIENT, getLastSeq: () => 2 });
    let fetched = 0; const orig = t.fetchSnapshot.bind(t); t.fetchSnapshot = async (ms?: number) => { fetched++; return orig(ms); };
    const gCodec = new FrameCodec({ sid: SID, deviceId: dev(3), device: undefined, ring: gRing, roster });
    const g = await GuestSession.join({ transport: t, decoder: codecDecoder(gCodec), clock: realClock, ids: { msg: nextId, que: nextId }, encoder: gCodec, sid: SID, openSnapshot: (bytes, seq) => openLanSnapshot(SID, gRing, bytes, seq) }); onStop(() => g.leave());
    return { g, gRing, fetched: () => fetched };
  };
  return { ...r, ring, key, say, view: () => view, lateGuest, hostCodec };
}
const texts = (s: GuestState) => s.transcript.filter((e) => e.kind === 'user').map((e) => (e as { text: string }).text);

describe('a late joiner is caught up from the host\'s snapshot (C075, C076)', () => {
  it('beyond the replay window the guest fetches the snapshot, restores from it and then replays what came after; nothing is missing or doubled', async () => {
    const w = await world(); const before = Array.from({ length: 30 }, (_x, i) => `m${i}`); for (const t of before) await w.say(t);
    await w.engine.snapshot(); const snap = (await w.persistence.latestSnapshot(SID))!; const after = Array.from({ length: 8 }, (_x, i) => `a${i}`); for (const t of after) await w.say(t);
    const { g, fetched } = await w.lateGuest(true); await wait(() => texts(g.state).length === 38); expect(texts(g.state)).toEqual([...before, ...after]);
    expect(fetched()).toBe(1); expect(g.state.lastSeq).toBe(w.engine.headSeq()); expect(g.state.warnings).toEqual([]);
    const seqs = g.state.transcript.map((e) => e.seq); expect(new Set(seqs).size).toBe(seqs.length); expect(seqs).toEqual([...seqs].sort((a, b) => a - b)); expect(snap.seq).toBeLessThan(g.state.lastSeq);
  });
  it('the restored roster and queue are the host\'s at the snapshot, and live frames after it keep folding in', async () => {
    const w = await world(); for (let i = 0; i < 20; i++) await w.say(`x${i}`); await w.engine.snapshot(); for (let i = 0; i < 4; i++) await w.say(`y${i}`);
    const { g } = await w.lateGuest(true); await wait(() => texts(g.state).length === 24 && g.state.roster.length > 0); expect(g.state.roster.map((m) => m.id)).toContain(mem(1)); expect(g.state.phase).toBe('live');
    await w.say('live one'); await wait(() => texts(g.state).at(-1) === 'live one'); expect(texts(g.state)).toHaveLength(25);
  });
  it('without the session key the guest waits, and takes the snapshot once the key arrives', async () => {
    const w = await world(); for (let i = 0; i < 20; i++) await w.say(`k${i}`); await w.engine.snapshot(); for (let i = 0; i < 4; i++) await w.say(`j${i}`);
    const { g, gRing } = await w.lateGuest(false); await wait(() => g.state.phase === 'waiting_for_key'); expect(texts(g.state)).toEqual([]);
    gRing.addEpoch('k1', w.key); g.keyArrived(); await wait(() => texts(g.state).length === 24); expect(texts(g.state)[0]).toBe('k0');
  });
  it('a host with no snapshot: the guest says earlier history is not available and starts at the host\'s head', async () => {
    const w = await world({ snapshots: false }); for (let i = 0; i < 20; i++) await w.say(`n${i}`);
    const { g } = await w.lateGuest(true); await wait(() => g.state.warnings.some((x) => x.reason === 'earlier_history_unavailable')); await wait(() => g.state.lastSeq === w.engine.headSeq()); expect(texts(g.state)).toEqual([]); await w.say('after'); await wait(() => texts(g.state).includes('after')); expect(texts(g.state)).toEqual(['after']);
  });
  it('a snapshot made for another seq is refused', async () => {
    const w = await world(); for (let i = 0; i < 3; i++) await w.say(`s${i}`); await w.engine.snapshot(); const snap = (await w.persistence.latestSnapshot(SID))!;
    expect(() => openLanSnapshot(SID, w.ring, snap.bytes, snap.seq + 1)).toThrow(); expect(openLanSnapshot(SID, w.ring, snap.bytes, snap.seq).seq).toBe(snap.seq);
  });
});
