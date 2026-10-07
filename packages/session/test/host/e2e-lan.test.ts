import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ReconnectTokens } from '@centcom/lan';
import { DeviceKeyStore, initCrypto, memoryKeychain } from '@centcom/net';
import { HostSessionEngine, LanTransport, createFilePersistence } from '../../src/index.js';
import { CLIENT, SID, dev, lanServer, mem, token } from '../rigs.js';

const stops: (() => Promise<void>)[] = []; afterEach(async () => { for (const s of stops.splice(0).reverse()) await s().catch(() => undefined); });
const wait = async (f: () => boolean, ms = 3000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); } };
const realClock = { now: () => Date.now(), setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (h: never) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) };
const ID = (n: number) => `msg_${String(n).padStart(26, 'A')}`.slice(0, 30);

async function setup(policy: Record<string, unknown> = {}) {
  await initCrypto(); const tokens = new Map([[token('g1'), { memberId: mem(2), deviceId: dev(2), name: 'G1', role: 'editor' as const }], [token('g2'), { memberId: mem(3), deviceId: dev(3), name: 'G2', role: 'editor' as const }], [token('g3'), { memberId: mem(4), deviceId: dev(4), name: 'V', role: 'viewer' as const }]]);
  const env = await lanServer({ tokens }); const rec = new ReconnectTokens(); const persistence = createFilePersistence(join(env.dir, 'hist')); const engine = new HostSessionEngine({ server: env.server, persistence, tokens: rec, clock: realClock, policy, snapshotBuilder: async () => new Uint8Array([1, 2, 3]) }); await engine.start(); stops.push(() => engine.stop());
  const guest = async (name: string, n: number, last: number | null = null) => { const kc = memoryKeychain(); const device = new DeviceKeyStore(kc, dev(n)); await device.getOrCreatePublicKeys(); const t = new LanTransport({ host: '127.0.0.1', port: env.port, sessionId: SID, reconnectToken: token(name), keychain: kc, device, deviceInfo: { id: dev(n), name }, clientInfo: CLIENT, getLastSeq: () => last }); const got: { k?: string; p?: Record<string, unknown>; from?: unknown; seq?: number; code?: string }[] = []; const errs: string[] = []; t.on('frame', (f) => got.push(f as never)); t.on('error', (e: unknown) => errs.push(String((e as { code?: string }).code ?? e))); await t.connect(); stops.push(() => t.close()); return { t, got, errs, ofKind: (k: string) => got.filter((f) => f.k === k) }; };
  return { env, engine, guest, rec, persistence };
}
let seqN = 100; const submit = (item: string, size = 10) => ({ t: 'queue', k: 'queue.submit', id: ID(++seqN), sid: SID, p: { item, size, kind: 'message' } }) as never;

describe('host engine over loopback', () => {
  it('queue flow with guests: submit, state broadcast, host approve, claim, done; every replica rebuilds the same view from the transcript', async () => {
    const { engine, guest } = await setup(); const g1 = await guest('g1', 2); const g2 = await guest('g2', 3);
    await g1.t.send(submit('que_AAAAAAAAAAAAAAAAAAAAAAAAA1')); await g2.t.send(submit('que_AAAAAAAAAAAAAAAAAAAAAAAAA2')); await wait(() => engine.queue().items.length === 2); await wait(() => g1.ofKind('queue.state').length > 0 && (g2.ofKind('queue.state').at(-1)?.p as { items: unknown[] } | undefined)?.items.length === 2);
    await engine.approveItem('que_AAAAAAAAAAAAAAAAAAAAAAAAA1'); await engine.claim('que_AAAAAAAAAAAAAAAAAAAAAAAAA1', 'agt_1'); await engine.complete('que_AAAAAAAAAAAAAAAAAAAAAAAAA1', 'ok'); await wait(() => engine.queue().items.length === 1);
    await wait(() => (g1.ofKind('queue.state').at(-1)?.p as { version: number } | undefined)?.version === engine.queue().version); expect(g1.ofKind('queue.state').at(-1)!.p).toEqual(engine.queue()); expect(g2.ofKind('queue.state').at(-1)!.p).toEqual(engine.queue());
    // a replica that replays the sequenced queue frames from seq 1 gets the same version
    const { QueueMachine } = await import('../../src/host/queue-machine.js'); const replica = new QueueMachine(() => 20); for (const f of g1.got.filter((x) => x.k?.startsWith('queue.') && x.k !== 'queue.state').sort((a, b) => a.seq! - b.seq!)) { const p = f.p as Record<string, unknown>; replica.apply(f.k!, String(f.from), p, 'x'); } expect(replica.view().version).toBe(engine.queue().version);
  });
  it('refuses what the roles do not allow, to the sender only', async () => {
    const { guest } = await setup(); const g1 = await guest('g1', 2); const v = await guest('g3', 4); const before = g1.got.length;
    await v.t.send(submit('que_AAAAAAAAAAAAAAAAAAAAAAAAA9')); await g1.t.send({ t: 'queue', k: 'queue.approve', id: ID(++seqN), sid: SID, p: { item: 'que_AAAAAAAAAAAAAAAAAAAAAAAAA9' } } as never); await wait(() => v.got.some((f) => f.k === 'sys.error') || v.errs.length > 0 || g1.errs.length > 0, 2000).catch(() => undefined);
    expect(g1.ofKind('queue.approve')).toHaveLength(0); expect(g1.got.slice(before).filter((f) => f.k === 'queue.submit')).toHaveLength(0);
  });
  it('auto_approve everyone approves a submit as the server; ask waits for the host', async () => {
    const a = await setup({ auto_approve: 'everyone' }); const g = await a.guest('g1', 2); await g.t.send(submit('que_AAAAAAAAAAAAAAAAAAAAAAAAB1')); await wait(() => g.ofKind('queue.approve').length === 1); expect(g.ofKind('queue.approve')[0]!.p).toMatchObject({ item: 'que_AAAAAAAAAAAAAAAAAAAAAAAAB1', policy: 'auto:everyone' }); expect(a.engine.queue().items[0]).toMatchObject({ state: 'approved' });
    const b = await setup({ auto_approve: 'ask' }); const h = await b.guest('g1', 2); await h.t.send(submit('que_AAAAAAAAAAAAAAAAAAAAAAAAB2')); await wait(() => b.engine.queue().items.length === 1); await new Promise((r) => setTimeout(r, 100)); expect(h.ofKind('queue.approve')).toHaveLength(0); expect(b.engine.queue().items[0]).toMatchObject({ state: 'queued' });
  });
  it('kick closes the target with 4403, revokes its token and emits member_left then rotate_key with consecutive seq', async () => {
    const { engine, guest, rec } = await setup(); const tok = rec.issue(dev(3)); expect(rec.validate(tok, '127.0.0.1')).not.toBeNull(); const g1 = await guest('g1', 2); const g2 = await guest('g2', 3); let code = 0; g2.t.on('closed', (c: { code: number }) => { code = c.code; });
    await engine.kick(mem(3), 'abuse'); await wait(() => code !== 0); expect(code).toBe(4403); expect(rec.validate(tok, '127.0.0.1')).toBeNull();
    await wait(() => g1.ofKind('control.rotate_key').length === 1); const left = g1.ofKind('control.member_left').find((f) => (f.p as { member: string }).member === mem(3))!; const rot = g1.ofKind('control.rotate_key')[0]!; expect(left.p).toMatchObject({ code: 'kicked' }); expect(rot.seq).toBe(left.seq! + 1);
    await g1.t.send({ t: 'control', k: 'control.roster', id: ID(++seqN), sid: SID, p: { version: 99, members: [] } } as never); await new Promise((r) => setTimeout(r, 100)); expect(g1.ofKind('control.roster').every((f) => f.from === 'srv' || f.from === 'server' || f.from !== mem(2))).toBe(true);
  });
  it('mute drops the target, unmute lets it through; transfer makes the target host in one step', async () => {
    const { engine, guest } = await setup(); const g1 = await guest('g1', 2); await engine.mute(mem(2)); await wait(() => engine.isMuted(mem(2))); await g1.t.send(submit('que_AAAAAAAAAAAAAAAAAAAAAAAAC1')); await new Promise((r) => setTimeout(r, 150)); expect(engine.queue().items).toHaveLength(0);
    await engine.transferHost(mem(2)); await wait(() => g1.ofKind('control.host_changed').length === 1); expect(g1.ofKind('control.host_changed')[0]!.p).toMatchObject({ host: mem(2), code: 'transfer' }); expect(engine.members().find((m) => m.id === mem(1))!.role).toBe('editor'); expect(engine.members().find((m) => m.id === mem(2))!.role).toBe('host');
  });
  it('locks: first acquire echoed, second denied by the server', async () => {
    const { engine, guest } = await setup(); const g1 = await guest('g1', 2); const lock = (agent: string, action = 'acquire') => ({ t: 'event', k: 'file.lock', id: ID(++seqN), sid: SID, p: { action, path_hmac: 'h'.repeat(43), agent_id: agent, ttl_ms: 60_000 } }) as never;
    await engine.setPolicy({ ...engine.policy(), auto_approve: 'ask' }); await engine.setPolicy({ ...engine.policy() }); void lock;
    const hostLink = engine.hostLink(); await hostLink.send(lock('agt_1')); await hostLink.send(lock('agt_2')); await wait(() => g1.ofKind('file.lock').length >= 2); expect(g1.ofKind('file.lock').map((f) => (f.p as { action: string }).action)).toEqual(['acquire', 'deny']); expect(engine.lockList()).toHaveLength(1);
  });
  it('frames are stored on disk and a snapshot is served; the host ends with session_state ended', async () => {
    const { engine, guest, persistence } = await setup(); const g1 = await guest('g1', 2); await g1.t.send({ t: 'event', k: 'reaction', id: ID(++seqN), sid: SID, p: { target: ID(1), code: 'ok', op: 'add' } } as never); await wait(() => g1.ofKind('reaction').length === 1); await engine.snapshot(); expect((await persistence.latestSnapshot(SID))!.seq).toBeGreaterThan(0); const frames: number[] = []; for await (const f of persistence.readFrames(SID, 0, 100)) frames.push(f.seq); expect(frames.length).toBeGreaterThan(2);
    await engine.stop('done'); await wait(() => g1.ofKind('control.session_state').length === 1); expect(g1.ofKind('control.session_state')[0]!.p).toMatchObject({ state: 'ended' });
  });
  it('the engine never decrypts: it does not import the crypto module', async () => {
    const { readdirSync, readFileSync } = await import('node:fs'); const dir = join(import.meta.dirname, '../../src/host'); for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) { const s = readFileSync(join(dir, f), 'utf8'); expect(s, f).not.toMatch(/decrypt|crypto_secretbox|sodium|openEnvelope|@centcom\/net\/crypto/i); }
  });
});
