import { afterEach, describe, expect, it } from 'vitest';
import { KeyRing, SessionError, SessionRest, fetchSnapshot, initCrypto, openSnapshot, sealSnapshot, sha256Ref, sodium, type SnapshotDoc } from '../../src/index.js';
import { ManualClock, WS, rig, until, virtualPeer } from './rig.js';

const SID = 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W'; const SNP = 'snp_01JA3Z8K2M5N7P9Q0R1S2T3V4W';
const mkRing = () => { const r = new KeyRing(); r.addEpoch('k1', sodium().crypto_aead_xchacha20poly1305_ietf_keygen()); return r; };
const doc = (n = 1): SnapshotDoc => ({ fmt: 'centcom.snapshot', v: 1, seq: 900, transcript: Array.from({ length: n }, (_, i) => ({ i, text: `line ${i}` })) });
const restFor = (d: Record<string, unknown> | null) => ({ snapshot: async () => d } as unknown as SessionRest);
const download = (bytes: Uint8Array, status = 200) => (async () => new Response(status === 200 ? (bytes as BodyInit) : 'no', { status })) as unknown as typeof fetch;

describe('seal and open', () => {
  it('round-trips a small and a large document (split into parts below the frame limit)', async () => { await initCrypto(); const ring = mkRing(); for (const n of [1, 40_000]) { const { bytes } = sealSnapshot(SID, SNP, ring, doc(n)); expect(openSnapshot(SID, SNP, ring, bytes)).toEqual(doc(n)); if (n > 1000) expect(JSON.parse(new TextDecoder().decode(bytes)).cts.length).toBeGreaterThan(1); } });
  it('the wrong key, another snapshot id, a flipped byte and a reordered part are all refused as snapshot_invalid', async () => {
    await initCrypto(); const ring = mkRing(); const { bytes } = sealSnapshot(SID, SNP, ring, doc(30_000)); const bad = (f: () => unknown) => expect(f).toThrowError(expect.objectContaining({ code: 'snapshot_invalid' }));
    bad(() => openSnapshot(SID, SNP, mkRing(), bytes)); bad(() => openSnapshot(SID, 'snp_OTHER', ring, bytes)); const t = new TextEncoder().encode(new TextDecoder().decode(bytes).replace('"c":"', '"c":"A')); bad(() => openSnapshot(SID, SNP, ring, t));
    const blob = JSON.parse(new TextDecoder().decode(bytes)); blob.cts.reverse(); bad(() => openSnapshot(SID, SNP, ring, new TextEncoder().encode(JSON.stringify(blob)))); bad(() => openSnapshot(SID, SNP, ring, new TextEncoder().encode('not json')));
  });
  it('an unknown fmt or version is refused with a clear message to update', async () => {
    await initCrypto(); const ring = mkRing(); for (const d of [{ ...doc(), fmt: 'other' }, { ...doc(), v: 2 }]) { const { bytes } = sealSnapshot(SID, SNP, ring, d as unknown as SnapshotDoc); const e = (() => { try { openSnapshot(SID, SNP, ring, bytes); } catch (x) { return x as SessionError; } })(); expect(e).toBeInstanceOf(SessionError); expect(e!.code).toBe('snapshot_unsupported'); expect(e!.message).toMatch(/Update Centcom/); }
    const blob = JSON.stringify({ v: 2, cts: [] }); expect(() => openSnapshot(SID, SNP, ring, new TextEncoder().encode(blob))).toThrowError(expect.objectContaining({ code: 'snapshot_unsupported' }));
  });
});
describe('fetch (acceptance 8)', () => {
  it('downloads, checks size and sha256, decrypts', async () => {
    await initCrypto(); const ring = mkRing(); const { bytes, kid } = sealSnapshot(SID, SNP, ring, doc()); const d = { snp: SNP, seq: 900, size: bytes.length, sha256: sha256Ref(bytes), kid, download_url: 'https://blobs.example/x' };
    const ok = await fetchSnapshot(restFor(d), SID, ring, { fetch: download(bytes) }); expect(ok?.seq).toBe(900); expect(ok?.doc).toEqual(doc()); expect(await fetchSnapshot(restFor(null), SID, ring, { fetch: download(bytes) })).toBeNull();
    const flipped = bytes.slice(); flipped[10] = flipped[10]! ^ 1; await expect(fetchSnapshot(restFor(d), SID, ring, { fetch: download(flipped) })).rejects.toMatchObject({ code: 'snapshot_invalid', message: expect.stringContaining('checksum') });
    await expect(fetchSnapshot(restFor({ ...d, size: bytes.length + 1 }), SID, ring, { fetch: download(bytes) })).rejects.toMatchObject({ code: 'snapshot_invalid', message: expect.stringContaining('size') }); await expect(fetchSnapshot(restFor(d), SID, ring, { fetch: download(bytes, 403) })).rejects.toMatchObject({ code: 'snapshot_invalid' });
    await expect(fetchSnapshot(restFor({ ...d, size: 40_000_000 }), SID, ring, { fetch: download(bytes) })).rejects.toBeInstanceOf(SessionError);
  });
});

let r: Awaited<ReturnType<typeof rig>> | undefined;
afterEach(async () => { await r?.host.handle?.leave().catch(() => undefined); await r?.guest.handle?.leave().catch(() => undefined); await r?.stop(); r = undefined; });
const snapCalls = (p: { seen: { method: string; path: string }[]; fetched: string[] }) => ({ begin: p.seen.filter((s) => s.method === 'POST' && /\/snapshot$/.test(s.path)).length, commit: p.seen.filter((s) => s.method === 'POST' && /\/snapshot\/[^/]+\/commit$/.test(s.path)).length, put: p.fetched.filter((f) => f.startsWith('PUT ')).length });
describe('upload (acceptance 9, 10)', () => {
  it('begin, PUT, commit with seq, sha256, size and kid; the guest then fetches and reads it', async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS, buildSnapshot: async ({ seq }) => ({ roster: ['x'], at: seq }) }); r.host.handle = h; const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; await until(() => g.state === 'live');
    const u = await h.snapshot.upload(); expect(u?.snp).toMatch(/^snp_/); expect(snapCalls(r.host)).toEqual({ begin: 1, commit: 1, put: 1 }); const order = r.host.seen.filter((s) => /snapshot/.test(s.path)).map((s) => s.method); expect(order).toEqual(['POST', 'POST']);
    const begin = r.host.seen.find((s) => s.method === 'POST' && /\/snapshot$/.test(s.path))!; const commit = r.host.seen.find((s) => /commit$/.test(s.path))!; expect(commit.body).toMatchObject({ kid: 'k1', size: expect.any(Number), sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/), seq: expect.any(Number) }); expect(begin.body).toMatchObject({ kid: 'k1' }); expect(begin.headers['idempotency-key']).toBeTruthy(); expect(commit.headers['idempotency-key']).toBeTruthy();
    const fetched = await g.snapshot.fetch(); expect(fetched?.doc).toMatchObject({ fmt: 'centcom.snapshot', v: 1, roster: ['x'] }); await expect(g.snapshot.upload()).rejects.toMatchObject({ code: 'not_host' });
  });
  it('triggers after 500 frames', async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS, buildSnapshot: async () => ({ n: 1 }) }); r.host.handle = h; const vp = await virtualPeer(r, h.id, 'Busy', mkRing(), 'editor'); await new Promise((x) => setTimeout(x, 100));
    for (let i = 0; i < 470; i++) vp.raw({ t: 'event', k: 'reaction', id: vp.nextId(), p: { target: 'msg_AAAAAAAAAAAAAAAAAAAAAAAAAA', code: 'ok', op: 'add' } }); await new Promise((x) => setTimeout(x, 300)); expect(snapCalls(r.host).commit).toBe(0);
    for (let i = 0; i < 60; i++) vp.raw({ t: 'event', k: 'reaction', id: vp.nextId(), p: { target: 'msg_AAAAAAAAAAAAAAAAAAAAAAAAAA', code: 'ok', op: 'add' } }); await until(() => snapCalls(r!.host).commit === 1, 6000); expect(snapCalls(r.host)).toEqual({ begin: 1, commit: 1, put: 1 });
  }, 20_000);
  it('triggers after 5 minutes of activity on the injected clock, and not when nothing happened', async () => {
    r = await rig(); const clock = new ManualClock(); await r.host.init({ clock }); const h = await r.host.client.createSession({ name: 'demo', workspace: WS, buildSnapshot: async () => ({ n: 1 }) }); r.host.handle = h;
    await clock.advance(299_000); expect(snapCalls(r.host).commit).toBe(0); await clock.advance(2_000); await new Promise((x) => setTimeout(x, 200)); expect(snapCalls(r.host).commit).toBe(1); const before = snapCalls(r.host).commit; await clock.advance(301_000); await new Promise((x) => setTimeout(x, 200)); expect(snapCalls(r.host).commit).toBe(before);
  });
  it('end() uploads a final snapshot, posts to /end, and ends the handle; leave() does neither', async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS, buildSnapshot: async () => ({ done: true }) }); r.host.handle = h; await h.end(); expect(snapCalls(r.host)).toEqual({ begin: 1, commit: 1, put: 1 }); expect(r.host.seen.some((s) => s.path === `/v1/sessions/${h.id}/end`)).toBe(true); expect(h.state).toBe('ended');
    const h2 = await r.host.client.createSession({ name: 'again', workspace: WS, buildSnapshot: async () => ({ done: true }) }); r.host.handle = h2; const before = snapCalls(r.host).commit; await h2.leave(); expect(snapCalls(r.host).commit).toBe(before);
  });
  it('without a builder no snapshot is made', async () => { r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; expect(await h.snapshot.upload()).toBeNull(); await h.end(); expect(snapCalls(r.host).begin).toBe(0); });
});
