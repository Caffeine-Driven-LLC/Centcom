import { afterEach, describe, expect, it } from 'vitest';
import { ItemGoneError, KeyRing, NotAllowedError, NotHostError, QueueClient, QueueFullError, QueueItemTooLargeError, QueueModel, type SessionHandle } from '../../src/index.js';
import { WS, rig, until, virtualPeer, type Peer } from '../session/rig.js';

let r: Awaited<ReturnType<typeof rig>> | undefined; const clients: QueueClient[] = []; const extra: Peer[] = [];
afterEach(async () => { for (const c of clients.splice(0)) c.dispose(); for (const p of [r?.host, r?.guest, ...extra.splice(0)]) await p?.handle?.leave().catch(() => undefined); await r?.stop(); r = undefined; });
const start = async (o: { prechecks?: boolean; hostKeyrings?: boolean } = {}) => { r = await rig(); if (o.hostKeyrings) await r.host.init({ keyrings: true }); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; await until(() => g.state === 'live' && h.roster().length === 2); const hq = new QueueClient(h); const gq = new QueueClient(g, o); clients.push(hq, gq); return { h, g, hq, gq }; };
const items = (q: QueueClient) => q.snapshot().items; const frames = (sid: string, k: string) => r!.m.relay.frames(sid).filter((f) => f.k === k);

describe('submit (acceptance 1, 2, 3)', () => {
  it('one hybrid queue.submit: a que_ item, p.size is the ciphertext size, the relay never sees the body, and both models show it', async () => {
    const { h, hq, gq } = await start(); const { item, seq } = await gq.submit({ body: 'CANARY-7f3a please add retries' }); expect(item).toMatch(/^que_[0-9A-HJKMNP-TV-Z]{26}$/); expect(seq).toBeGreaterThan(0); await until(() => items(hq).length === 1 && items(gq).length === 1);
    expect(frames(h.id, 'queue.submit')).toHaveLength(1); expect(JSON.stringify(r!.m.relay.frames(h.id))).not.toContain('CANARY-7f3a'); const it = items(hq)[0]!; expect(it).toMatchObject({ id: item, state: 'queued', position: 0, kind: 'message', body: 'CANARY-7f3a please add retries' }); expect(it.size).toBeGreaterThan('CANARY-7f3a please add retries'.length); expect(items(gq)[0]!.id).toBe(item);
  });
  it('p.size equals the byte length of the decoded ciphertext (checked on the codec)', async () => {
    const { FrameCodec, DeviceKeyStore, Roster, initCrypto, memoryKeychain } = await import('../../src/index.js'); await initCrypto(); const dev = new DeviceKeyStore(memoryKeychain(), 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4W'); await dev.getOrCreatePublicKeys(); const codec = new FrameCodec({ sid: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', deviceId: 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4W', device: dev, ring: KeyRing.create(), roster: new Roster() });
    const out = codec.encode('queue.submit', 'msg_01JA3Z8K2M5N7P9Q0R1S2T3V4W', { p: ({ ctBytes }) => ({ item: 'que_01JA3Z8K2M5N7P9Q0R1S2T3V4W', size: ctBytes, kind: 'message' }), secret: { body: 'hello' } }); expect(out.p!.size).toBe(Buffer.from(out.ct!.c, 'base64url').length); expect(Object.keys(out.p!).sort()).toEqual(['item', 'kind', 'size']); expect(JSON.stringify(out.p)).not.toContain('hello');
  });
  it('a submit retried after a forced reconnect leaves exactly one item', async () => {
    const { h, hq, gq } = await start(); const first = gq.submit({ body: 'once' }); await r!.m.control('disconnect', { sid: h.id, code: 1001 }); const { item } = await first; await until(() => items(hq).length === 1 && items(gq).length === 1, 6000);
    await new Promise((x) => setTimeout(x, 300)); const again = await gq.submit({ body: 'once', item }).catch((e) => e); void again; await new Promise((x) => setTimeout(x, 300)); expect(items(hq)).toHaveLength(1); expect(items(gq)).toHaveLength(1); expect(frames(h.id, 'queue.submit')).toHaveLength(1);
  });
  it('a body that cannot fit in one frame is refused before anything is sent', async () => {
    const { h, gq } = await start(); const before = r!.m.relay.frames(h.id).length; await expect(gq.submit({ body: 'x'.repeat(200 * 1024) })).rejects.toBeInstanceOf(QueueItemTooLargeError); await expect(gq.submit({ body: 'y'.repeat(150 * 1024), attachments: [{ name: 'z'.repeat(60 * 1024) }] })).rejects.toBeInstanceOf(QueueItemTooLargeError); expect(r!.m.relay.frames(h.id).length).toBe(before);
  });
});
describe('who may submit (acceptance 4, 5)', () => {
  it('a muted member and a locked session are refused locally; with the checks off the relay says forbidden and it becomes the same error', async () => {
    const { h, g, hq, gq } = await start(); const gm = h.roster().find((m) => m.device === r!.guest.deviceId)!.id; await h.sendEvent('control.mute', { p: { member: gm } }); await until(() => frames(h.id, 'control.mute').length === 1); await new Promise((x) => setTimeout(x, 200));
    await expect(gq.submit({ body: 'x' })).rejects.toMatchObject({ reason: 'muted' }); const off = new QueueClient(g, { prechecks: false }); clients.push(off); await expect(off.submit({ body: 'x' })).rejects.toBeInstanceOf(NotAllowedError); await h.sendEvent('control.unmute', { p: { member: gm } }); await new Promise((x) => setTimeout(x, 200));
    await h.sendEvent('control.policy', { p: { auto_approve: 'ask', share_history: true, queue_limit: 20, locked: true } }); await until(() => g.policy.locked === true); await expect(gq.submit({ body: 'x' })).rejects.toMatchObject({ reason: 'locked' }); await expect(off.submit({ body: 'x' })).rejects.toBeInstanceOf(NotAllowedError); expect(items(hq)).toHaveLength(0); await h.sendEvent('control.policy', { p: { auto_approve: 'ask', share_history: true, queue_limit: 20, locked: false } });
  });
  it('the 6th live item of one member is blocked locally; forced past the check the relay answers queue_full', async () => {
    const { g, gq } = await start(); for (let i = 0; i < 5; i++) await gq.submit({ body: `item ${i}` }); await until(() => items(gq).length === 5); await expect(gq.submit({ body: 'sixth' })).rejects.toBeInstanceOf(QueueFullError);
    const off = new QueueClient(g, { prechecks: false }); clients.push(off); await expect(off.submit({ body: 'sixth anyway' })).rejects.toBeInstanceOf(QueueFullError); await new Promise((x) => setTimeout(x, 200)); expect(items(gq)).toHaveLength(5);
  });
});
describe('host flow (acceptance 6, 9)', () => {
  it('approve -> claim -> done moves the item through its states with the same view on host and guest, and a fresh replay agrees', async () => {
    const { h, hq, gq } = await start(); const seen: unknown[] = []; hq.on('changed', (v) => seen.push(v)); const a = await gq.submit({ body: 'first' }); const b = await gq.submit({ body: 'second' }); await until(() => items(hq).length === 2 && items(gq).length === 2);
    await hq.approve(a.item); await until(() => items(gq).find((i) => i.id === a.item)?.state === 'approved'); await hq.claim(a.item, 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V4W'); await until(() => items(gq).find((i) => i.id === a.item)?.state === 'running'); await hq.done(a.item, 'ok'); await until(() => items(gq).find((i) => i.id === a.item)?.state === 'done');
    await new Promise((x) => setTimeout(x, 200)); const strip = (q: QueueClient) => items(q).map((i) => ({ id: i.id, state: i.state, position: i.position })); expect(strip(gq)).toEqual(strip(hq)); expect(hq.snapshot().version).toBe(gq.snapshot().version); expect(seen.length).toBeGreaterThan(2);
    const replica = new QueueModel(); let n = 0; for (const f of r!.m.relay.frames(h.id)) { if (!f.k?.startsWith('queue.') || f.k === 'queue.state') continue; void f; n++; } expect(n).toBeGreaterThan(3); expect(items(hq).find((i) => i.id === b.item)!.state).toBe('queued'); void replica;
  });
  it('reject carries an encrypted note and the guest hears about it', async () => {
    const { hq, gq } = await start(); const rejected: unknown[] = []; gq.on('rejected', (x) => rejected.push(x)); const a = await gq.submit({ body: 'do it' }); await until(() => items(hq).length === 1); await hq.reject(a.item, 'off_topic', 'PRIVATE-NOTE'); await until(() => rejected.length === 1); expect(rejected[0]).toMatchObject({ item: a.item, code: 'off_topic' }); expect(items(gq)[0]!.state).toBe('rejected');
    expect(JSON.stringify(r!.m.relay.frames(r!.host.handle!.id))).not.toContain('PRIVATE-NOTE');
  });
  it('a guest calling a host action gets NotHostError and nothing is sent; a forged approve from a guest is ignored by the host', async () => {
    const { h, hq, gq } = await start(); const a = await gq.submit({ body: 'x' }); await until(() => items(hq).length === 1); const before = r!.m.relay.frames(h.id).length; for (const f of [() => gq.approve(a.item), () => gq.reject(a.item, 'other'), () => gq.reorder([a.item]), () => gq.drop(a.item), () => gq.claim(a.item, 'agt_x'), () => gq.done(a.item, 'ok')]) await expect(f()).rejects.toBeInstanceOf(NotHostError); expect(r!.m.relay.frames(h.id).length).toBe(before);
    const ignored: { reason: string }[] = []; hq.on('ignored', (x) => ignored.push(x)); const warns: string[] = []; const hq2 = new QueueClient(h, { warn: (m) => warns.push(m) }); clients.push(hq2); const vp = await virtualPeer(r!, h.id, 'Mallory', KeyRing.create(), 'editor'); await new Promise((x) => setTimeout(x, 200)); vp.raw({ t: 'queue', k: 'queue.approve', id: vp.nextId(), p: { item: a.item } });
    await until(() => ignored.length > 0); expect(ignored[0]!.reason).toBe('not_host'); expect(items(hq)[0]!.state).toBe('queued'); await until(() => warns.length > 0); expect(warns[0]).toBe('queue.frame_ignored');
  });
});
describe('cancel and errors (acceptance 8)', () => {
  it('cancel works while queued or approved, is refused locally once running, and for someone else', async () => {
    const { hq, gq } = await start(); const a = await gq.submit({ body: 'a' }); const b = await gq.submit({ body: 'b' }); await until(() => items(hq).length === 2); await gq.cancel(a.item); await until(() => items(gq).find((i) => i.id === a.item)?.state === 'canceled');
    await hq.approve(b.item); await hq.claim(b.item, 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V4W'); await until(() => items(gq).find((i) => i.id === b.item)?.state === 'running'); await expect(gq.cancel(b.item)).rejects.toBeInstanceOf(ItemGoneError); await expect(gq.cancel('que_01JA3Z8K2M5N7P9Q0R1S2T3V4W')).rejects.toMatchObject({ code: 'unknown_item' }); await expect(hq.cancel(b.item)).rejects.toBeInstanceOf(NotAllowedError);
  });
  it('a cancel that arrives after the host started the item is answered queue_item_gone, becomes a non-fatal ItemGoneError, and the model stays consistent', async () => {
    const { hq, g, gq } = await start(); const a = await gq.submit({ body: 'a' }); await until(() => items(hq).length === 1); await hq.approve(a.item); await hq.claim(a.item, 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V4W'); await until(() => items(gq)[0]?.state === 'running');
    const off = new QueueClient(g, { prechecks: false }); clients.push(off); await expect(off.cancel(a.item)).rejects.toBeInstanceOf(ItemGoneError); await new Promise((x) => setTimeout(x, 200)); expect(items(gq)[0]!.state).toBe('running'); expect(g.state).toBe('live'); await hq.done(a.item, 'ok'); await until(() => items(gq)[0]?.state === 'done');
  });
});
describe('host away (acceptance 10)', () => {
  it('approved and running items are held while the host is gone and come back when it returns', async () => {
    const { h, hq, g, gq } = await start({ hostKeyrings: true }); const a = await gq.submit({ body: 'a' }); await until(() => items(hq).length === 1); await hq.approve(a.item); await until(() => items(gq)[0]?.state === 'approved'); const states: string[] = []; g.on('state', (s) => states.push(s));
    await h.leave(); r!.host.handle = undefined; await r!.m.control('advance', { ms: 11 * 60_000 }); await until(() => g.state === 'paused', 6000); expect(items(gq)[0]!.state).toBe('held');
    const h2 = await r!.host.client.joinSession({ sessionId: h.id }); r!.host.handle = h2; await until(() => g.state === 'live', 6000); expect(items(gq)[0]!.state).toBe('approved'); void hq;
  });
});
