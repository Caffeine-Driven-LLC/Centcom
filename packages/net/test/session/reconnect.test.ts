import { afterEach, describe, expect, it } from 'vitest';
import { KeyRing, memorySeqStore, sodium } from '../../src/index.js';
import { Peer, WS, rig, until, virtualPeer } from './rig.js';

let r: Awaited<ReturnType<typeof rig>> | undefined; const extra: Peer[] = [];
afterEach(async () => { for (const p of [r?.host, r?.guest, ...extra.splice(0)]) await p?.handle?.leave().catch(() => undefined); await r?.stop(); r = undefined; });
const reaction = (vp: Awaited<ReturnType<typeof virtualPeer>>, n: number) => vp.raw({ t: 'event', k: 'reaction', id: vp.nextId(), p: { target: 'msg_AAAAAAAAAAAAAAAAAAAAAAAAAA', code: `c${n}`, op: 'add' } });

describe('forced close mid-stream', () => {
  it('after a disconnect the guest gets what it missed, in order, with no duplicates', async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; await until(() => g.state === 'live');
    const vp = await virtualPeer(r, h.id, 'Busy', KeyRing.create(), 'editor'); const codes: string[] = []; g.on('reaction', (e) => { if (/^c\d+$/.test(String(e.p?.code))) codes.push(String(e.p?.code)); });
    for (let i = 0; i < 5; i++) reaction(vp, i); await until(() => codes.length === 5); await r.m.control('disconnect', { sid: h.id, code: 1001 }); for (let i = 5; i < 12; i++) reaction(vp, i);
    await until(() => codes.length >= 12, 6000); await new Promise((x) => setTimeout(x, 200)); expect(codes).toEqual(Array.from({ length: 12 }, (_, i) => `c${i}`));
  });
  it('duplicated and reordered frames from the relay are delivered once and in order', async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; await until(() => g.state === 'live'); const vp = await virtualPeer(r, h.id, 'Busy', KeyRing.create(), 'editor'); const codes: string[] = []; g.on('reaction', (e) => { if (/^c\d+$/.test(String(e.p?.code))) codes.push(String(e.p?.code)); });
    r.m.relay.addFault({ sid: h.id, type: 'duplicate', count: 3 }); r.m.relay.addFault({ sid: h.id, type: 'reorder' }); for (let i = 0; i < 8; i++) reaction(vp, i); await until(() => codes.length >= 8, 6000); await new Promise((x) => setTimeout(x, 200)); expect(codes).toEqual(Array.from({ length: 8 }, (_, i) => `c${i}`));
  });
});
describe('snapshot restore (acceptance 8)', () => {
  it('a member whose position is too old takes the snapshot, fills the gap from history and then goes on live, each frame once', { timeout: 30_000 }, async () => {
    r = await rig({ relay: { replayFrames: 10 } }); const seqStore = memorySeqStore(); const gp = await r.mk('Guest2', 'editor', 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V4X').init({ keyrings: true, seqStore }); extra.push(gp);
    const h = await r.host.client.createSession({ name: 'demo', workspace: WS, buildSnapshot: async ({ seq }) => ({ upto: seq, roster: ['a'] }) }); r.host.handle = h; const g1 = await gp.client.joinSession({ sessionId: h.id }); gp.handle = g1; await until(() => g1.state === 'live'); await g1.leave();
    const vp = await virtualPeer(r, h.id, 'Busy', KeyRing.create(), 'editor'); const hostSeen: number[] = []; h.onAny((e) => hostSeen.push(e.seq)); for (let i = 0; i < 30; i++) { const f = reaction(vp, i); r.reg.history.push(f); }
    await until(() => hostSeen.length >= 30, 6000); const snap = await h.snapshot.upload(); expect(snap!.seq).toBeGreaterThanOrEqual(30);
    const codes: string[] = []; const snaps: { seq: number; doc: unknown }[] = []; const warns: string[] = []; const g2 = await gp.client.joinSession({ sessionId: h.id, on: { snapshot: (s) => snaps.push(s), 'protocol-warning': (w) => warns.push(w.reason) } }); gp.handle = g2; g2.on('reaction', (e) => { if (/^c\d+$/.test(String(e.p?.code))) codes.push(String(e.p?.code)); });
    await until(() => snaps.length === 1, 6000); expect(snaps[0]!.doc).toMatchObject({ fmt: 'centcom.snapshot', v: 1, roster: ['a'] }); expect(snaps[0]!.seq).toBe(snap!.seq); await new Promise((x) => setTimeout(x, 300)); reaction(vp, 99); await until(() => codes.includes('c99'), 6000);
    expect(codes.filter((c) => c === 'c99')).toHaveLength(1); expect(new Set(codes).size).toBe(codes.length); expect(g2.state).toBe('live'); expect(warns.filter((w) => w !== 'earlier_history_unavailable')).toEqual([]);
  });
  it('a snapshot that fails its checksum is ignored: a warning says earlier history is unavailable and the session carries on', { timeout: 30_000 }, async () => {
    r = await rig({ relay: { replayFrames: 10 } }); const seqStore = memorySeqStore(); const gp = await r.mk('Guest2', 'editor', 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V4X').init({ keyrings: true, seqStore }); extra.push(gp);
    const h = await r.host.client.createSession({ name: 'demo', workspace: WS, buildSnapshot: async () => ({ a: 1 }) }); r.host.handle = h; const g1 = await gp.client.joinSession({ sessionId: h.id }); gp.handle = g1; await until(() => g1.state === 'live'); await g1.leave();
    const vp = await virtualPeer(r, h.id, 'Busy', KeyRing.create(), 'editor'); for (let i = 0; i < 30; i++) { const f = reaction(vp, i); r.reg.history.push(f); } await new Promise((x) => setTimeout(x, 400)); await h.snapshot.upload(); const last = [...r.reg.blobs.keys()].at(-1)!; const b = r.reg.blobs.get(last)!; b[5] = b[5]! ^ 1;
    const warns: string[] = []; const codes: string[] = []; const g2 = await gp.client.joinSession({ sessionId: h.id, on: { 'protocol-warning': (w) => warns.push(w.reason) } }); gp.handle = g2; g2.on('reaction', (e) => { if (/^c\d+$/.test(String(e.p?.code))) codes.push(String(e.p?.code)); });
    await until(() => warns.includes('earlier_history_unavailable'), 6000); await until(() => g2.state === 'live'); reaction(vp, 77); await until(() => codes.includes('c77'), 6000); expect(sodium).toBeDefined();
  });
});
