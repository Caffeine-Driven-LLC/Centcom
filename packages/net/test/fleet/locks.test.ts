import { afterEach, describe, expect, it } from 'vitest';
import { FleetSync, KeyRing, SpawnRejectedError, hmacFor, initCrypto, pathHmac, type LockBackend } from '../../src/index.js';
import { WS, rig, until, type Peer } from '../session/rig.js';

const real = { now: () => Date.now(), setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: never) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) };
const A1 = 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V4W'; const A2 = 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V5X';
let r: Awaited<ReturnType<typeof rig>> | undefined; const syncs: FleetSync[] = []; const extra: Peer[] = [];
afterEach(async () => { for (const f of syncs.splice(0)) f.stop(); for (const p of [r?.host, r?.guest, ...extra.splice(0)]) await p?.handle?.leave().catch(() => undefined); await r?.stop(); r = undefined; });
const backend = () => { const released: string[] = []; const remote: string[] = []; const b: LockBackend = { release: (path, agent) => { released.push(`${path}:${agent}`); }, onRemoteLock: (e) => { remote.push(`${e.action}:${e.agent_id}`); } }; return { b, released, remote }; };
const start = async (o: { relay?: { maxParallelAgents?: number } } = {}) => { r = await rig(o.relay ? { relay: o.relay } : {}); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; await until(() => g.state === 'live' && h.roster().length === 2); const hb = backend(); const gb = backend(); const hf = new FleetSync(h, { clock: real, locks: hb.b }); const gf = new FleetSync(g, { clock: real, locks: gb.b }); hf.start(); gf.start(); syncs.push(hf, gf); return { h, g, hf, gf, hb, gb }; };

describe('lock arbitration (acceptance 3, 4)', () => {
  it('the first agent is granted, the second is denied by the server and lock-denied fires; the hash is the same for both members and the path never appears in the clear', async () => {
    const { h, g, hf, gf } = await start(); const denied: unknown[] = []; gf.on('lock-denied', (e) => denied.push(e)); expect(await hf.acquire(A1, 'src/a.ts')).toBe('granted'); expect(await gf.acquire(A2, 'src/a.ts')).toBe('denied'); await until(() => denied.length === 1); expect(denied[0]).toMatchObject({ agentId: A2 });
    expect(hf.fleet().locks).toHaveLength(1); await until(() => gf.fleet().locks.length === 1); expect(gf.fleet().locks[0]).toMatchObject({ agentId: A1, path: 'src/a.ts' }); expect(hf.fleet().locks[0]!.pathHmac).toBe(gf.fleet().locks[0]!.pathHmac); expect(JSON.stringify(r!.m.relay.frames(h.id))).not.toContain('src/a.ts'); expect(g.pathMac('src/a.ts')).toBe(h.pathMac('src/a.ts')); expect(g.pathMac('src/a.ts')).not.toBe(g.pathMac('src/b.ts'));
    await hf.release(A1, 'src/a.ts'); await until(() => hf.fleet().locks.length === 0 && gf.fleet().locks.length === 0); expect(await gf.acquire(A2, 'src/a.ts')).toBe('granted');
  });
  it('the same agent may take its own lock again; a denied frame is not resent after a reconnect', async () => {
    const { hf, gf, h } = await start(); expect(await hf.acquire(A1, 'x.ts')).toBe('granted'); expect(await hf.acquire(A1, 'x.ts')).toBe('granted'); expect(await gf.acquire(A2, 'x.ts')).toBe('denied'); await r!.m.control('disconnect', { sid: h.id, code: 1001 }); await until(() => hf.fleet().locks.length >= 0 && h.state === 'live', 6000); await new Promise((x) => setTimeout(x, 500));
    expect(r!.m.relay.frames(h.id).filter((f) => f.k === 'file.lock' && f.from === 'srv').length).toBe(1); /* one denial in all */
  });
  it('a lock with a ttl ends with a server expire; the local backend is told to let go; the lock leaves the view', async () => {
    const { hf, hb, gf } = await start(); expect(await hf.acquire(A1, 'src/b.ts', 30_000)).toBe('granted'); await until(() => gf.fleet().locks.length === 1); const expired: unknown[] = []; hf.on('lock-expired', (e) => expired.push(e)); await r!.m.control('advance', { ms: 31_000 }); await until(() => expired.length === 1); expect(expired[0]).toMatchObject({ agentId: A1, path: 'src/b.ts' }); expect(hb.released).toEqual(['src/b.ts:' + A1]); await until(() => hf.fleet().locks.length === 0 && gf.fleet().locks.length === 0);
  });
  it('remote lock events reach the local backend; the lock transport of the local lock client goes through the same path', async () => {
    const { hf, gf, gb } = await start(); const t = hf.lockTransport(); expect(t.ready?.()).toBe(true); t.publish({ clear: { action: 'acquire', path_hmac: 'ignored', agent_id: A1, ttl_ms: 20_000 }, secret: { path: 'src/c.ts' } }); await until(() => gf.fleet().locks.length === 1); expect(gb.remote).toContain(`acquire:${A1}`); t.publish({ clear: { action: 'release', path_hmac: 'ignored', agent_id: A1 }, secret: { path: 'src/c.ts' } }); await until(() => gf.fleet().locks.length === 0);
  });
});
describe('hash consistency (acceptance 3)', () => {
  it('equals the contract function for the current epoch, and another session key gives another hash', async () => {
    await initCrypto(); const ring = KeyRing.create(); const other = KeyRing.create(); const { hmac, kid } = hmacFor(ring, 'src/a.ts'); expect(hmac).toBe(pathHmac(ring, kid, 'src/a.ts')); expect(hmacFor(other, 'src/a.ts').hmac).not.toBe(hmac);
  });
});
describe('spawn limit (acceptance 9)', () => {
  it('the relay refuses a second agent when the limit is one; the refusal is a typed error and the view has only the first', async () => {
    const { hf, gf } = await start({ relay: { maxParallelAgents: 1 } }); await hf.spawn({ agentId: A1, mode: 'branch', label: 'one' }); await expect(hf.spawn({ agentId: A2, mode: 'branch' })).rejects.toBeInstanceOf(SpawnRejectedError); await until(() => gf.fleet().members.length === 1); expect(hf.fleet().members[0]!.agents.map((a) => a.agentId)).toEqual([A1]); await hf.exit(A1, 'ok'); await hf.spawn({ agentId: A2, mode: 'branch' });
  });
});
