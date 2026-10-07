import { join as pjoin } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ReconnectTokens } from '@centcom/lan';
import { DeviceKeyStore, initCrypto, memoryKeychain } from '@centcom/net';
import type { Frame } from '@centcom/protocol';
import { GuestSession, HostSessionEngine, LanTransport, SERVER, createFilePersistence, type FrameDecoder, type GuestClock } from '../../src/index.js';
import type { SessionTransport } from '../../src/transport/types.js';
import { CLIENT, SID, dev, lanServer, mem, token } from '../rigs.js';

const ME = mem(2), HOST = mem(1); let n = 0; const msg = () => `msg_${String(++n).padStart(26, 'A')}`.slice(0, 30); const que = () => `que_${String(++n).padStart(26, 'A')}`.slice(0, 30);
const passthrough: FrameDecoder = { decode: (f) => ({ kind: 'ok', frame: f }) };
const clock = (): GuestClock & { advance(ms: number): void; timers: number } => { let t = 0; const q: { at: number; fn: () => void }[] = []; return { now: () => t, setTimeout: (fn, ms) => { q.push({ at: t + ms, fn }); return q.length; }, clearTimeout: () => undefined, advance(ms) { t += ms; for (const x of q.filter((y) => y.at <= t)) { q.splice(q.indexOf(x), 1); x.fn(); } }, get timers() { return q.length; } }; };
const sign = async () => 'A'.repeat(86); const sealBody = async (b: string) => ({ alg: 'xchacha20poly1305', kid: 'k1', n: 'A'.repeat(32), c: Buffer.from(b).toString('base64') });

/** A transport the test drives by hand. */
function fake(role: 'host' | 'editor' | 'viewer' = 'editor') {
  const h: Record<string, ((...a: never[]) => void)[]> = {}; const sent: Frame[] = []; let connects = 0; let ready = true;
  const on = (ev: string, fn: (...a: never[]) => void) => { (h[ev] ??= []).push(fn); return () => undefined; }; const emit = (ev: string, ...a: unknown[]) => { for (const f of h[ev] ?? []) (f as (...x: unknown[]) => void)(...a); };
  const t = { kind: 'local', capabilities: {}, state: 'ready', on, send: async (f: Frame) => { if (!ready) throw new Error('offline'); sent.push(f); }, connect: async () => { connects++; emit('welcome', { member: { id: ME, name: 'Me', slot: 1, role }, role, slot: 1, resume: connects > 1 ? { from_seq: 1 } : null, roster_v: 1 }); return {} as never; }, close: async () => undefined } as unknown as SessionTransport;
  return { t, sent, emit, connects: () => connects, setReady: (v: boolean) => { ready = v; } };
}
const sf = (seq: number, k: string, from: string, p: Record<string, unknown>, t: Frame['t'] = 'control'): Frame => ({ v: 1, t, id: msg(), sid: SID, from, ts: '2026-10-07T00:00:00.000Z', k, seq, p }) as Frame;
const rosterFrame = (role: string) => sf(1, 'control.roster', SERVER, { version: 1, members: [{ id: HOST, name: 'H', slot: 0, role: 'host' }, { id: ME, name: 'Me', slot: 1, role }] });
async function open(role: 'host' | 'editor' | 'viewer' = 'editor', extra: Partial<Parameters<typeof GuestSession.join>[0]> = {}) { const f = fake(role); const c = clock(); const g = await GuestSession.join({ transport: f.t, decoder: passthrough, clock: c, ids: { msg, que }, sealBody, sign, sid: SID, random: () => 0, ...extra }); f.emit('frame', rosterFrame(role)); return { f, c, g }; }

describe('join and queue', () => {
  it('is live after welcome and the roster', async () => { const f = fake(); const g = await GuestSession.join({ transport: f.t, decoder: passthrough, clock: clock(), ids: { msg, que }, sealBody, sign, sid: SID }); expect(g.state.phase).toBe('connecting'); f.emit('frame', rosterFrame('editor')); expect(g.state.phase).toBe('live'); expect(g.state.me).toMatchObject({ member: ME, role: 'editor', slot: 1 }); });
  it('submit sends a queue.submit with a fresh item id, size = ciphertext bytes and no plaintext, and resolves on the echo', async () => {
    const { f, g } = await open(); const pr = g.submit('hello world'); await Promise.resolve(); await new Promise((r) => setTimeout(r, 5)); const out = f.sent[0]!; expect(out.k).toBe('queue.submit'); expect(out.p).toMatchObject({ size: 11, kind: 'message' }); expect(String((out.p as { item: string }).item)).toMatch(/^que_/); expect(JSON.stringify(out)).not.toContain('hello world'); let done = false; void pr.then(() => { done = true; }); await new Promise((r) => setTimeout(r, 5)); expect(done).toBe(false);
    f.emit('frame', { ...out, from: ME, seq: 2, ts: 'x' }); expect(await pr).toBe((out.p as { item: string }).item);
  });
  it('a resend after a forced disconnect uses the same frame id; the host answers it once', async () => {
    const { f, g } = await open(); f.emit('closed', { code: 1006, willReconnect: true }); f.setReady(false); const pr = g.submit('x'); await new Promise((r) => setTimeout(r, 5)); expect(f.sent).toHaveLength(0); f.setReady(true); expect(g.state.phase).toBe('reconnecting'); await f.t.connect(); await new Promise((r) => setTimeout(r, 5)); expect(f.sent).toHaveLength(1); const first = f.sent[0]!; await f.t.connect(); await new Promise((r) => setTimeout(r, 5)); expect(f.sent[1]!.id).toBe(first.id); expect((f.sent[1]!.p as { item: string }).item).toBe((first.p as { item: string }).item); f.emit('frame', { ...first, from: ME, seq: 2 }); await pr;
  });
  it('a viewer or a muted member is refused locally without sending (acceptance 6)', async () => {
    const v = await open('viewer'); await expect(v.g.submit('x')).rejects.toMatchObject({ code: 'forbidden' }); expect(v.f.sent).toHaveLength(0);
    const m = await open('editor'); m.f.emit('frame', sf(2, 'control.mute', HOST, { member: ME })); expect(m.g.state.me.muted).toBe(true); await expect(m.g.submit('x')).rejects.toMatchObject({ code: 'forbidden' }); expect(m.f.sent).toHaveLength(0);
  });
  it('the sixth live item is refused with queue_full (acceptance 7); a server queue_full is just another error to the caller', async () => {
    const { f, g } = await open(); f.emit('frame', sf(2, 'queue.state', SERVER, { version: 1, items: Array.from({ length: 5 }, (_, i) => ({ item: `que_${i}`, submitter: ME, state: i ? 'queued' : 'running', position: i, size: 1, kind: 'message', ts: 't' })) }, 'queue')); await expect(g.submit('x')).rejects.toMatchObject({ code: 'queue_full' }); expect(f.sent).toHaveLength(0);
    f.emit('frame', sf(3, 'queue.state', SERVER, { version: 2, items: [{ item: 'que_0', submitter: ME, state: 'done', position: null, size: 1, kind: 'message', ts: 't' }, ...Array.from({ length: 4 }, (_, i) => ({ item: `que_${i + 1}`, submitter: ME, state: 'queued', position: i, size: 1, kind: 'message', ts: 't' }))] }, 'queue')); void g.submit('x').catch(() => undefined); await new Promise((r) => setTimeout(r, 5)); expect(f.sent).toHaveLength(1);
  });
  it('cancel is for your own queued or approved item only', async () => {
    const { f, g } = await open(); f.emit('frame', sf(2, 'queue.state', SERVER, { version: 1, items: [{ item: 'que_a', submitter: ME, state: 'queued', position: 0, size: 1, kind: 'm', ts: 't' }, { item: 'que_b', submitter: 'mem_other', state: 'queued', position: 1, size: 1, kind: 'm', ts: 't' }, { item: 'que_c', submitter: ME, state: 'running', position: null, size: 1, kind: 'm', ts: 't' }] }, 'queue'));
    await expect(g.cancel('que_b')).rejects.toMatchObject({ code: 'forbidden' }); await expect(g.cancel('que_c')).rejects.toMatchObject({ code: 'queue_item_gone' }); await expect(g.cancel('nope')).rejects.toMatchObject({ code: 'queue_item_gone' }); void g.cancel('que_a').catch(() => undefined); await new Promise((r) => setTimeout(r, 5)); expect(f.sent[0]).toMatchObject({ k: 'queue.cancel', p: { item: 'que_a' } });
  });
});

describe('failures (acceptance 8, 10)', () => {
  it('a frame whose signature fails is dropped and recorded, never thrown', async () => { const bad: FrameDecoder = { decode: (x) => (x.seq === 2 ? { kind: 'drop', reason: 'bad_sig' } : { kind: 'ok', frame: x }) }; const { f, g } = await open('editor', { decoder: bad }); f.emit('frame', sf(2, 'message.user', 'mem_zz', {}, 'event')); expect(g.state.warnings.at(-1)).toMatchObject({ reason: 'bad_sig', seq: 2 }); expect(g.state.lastSeq).toBe(2); });
  it('4403 ends kicked without reconnecting; 4404 ends; 4426 ends with a warning', async () => {
    for (const [code, phase] of [[4403, 'kicked'], [4404, 'ended'], [4426, 'ended']] as const) { const { f, g, c } = await open(); f.emit('closed', { code, willReconnect: false }); expect(g.state.phase, String(code)).toBe(phase); c.advance(5000); expect(f.connects(), String(code)).toBe(1); }
  });
  it('4401 refreshes the ticket once, then reconnects; a second 4401 ends', async () => { let refreshed = 0; const { f, g } = await open('editor', { refreshTicket: async () => { refreshed++; } }); f.emit('closed', { code: 4401, willReconnect: false }); await new Promise((r) => setTimeout(r, 10)); expect(refreshed).toBe(1); expect(f.connects()).toBe(2); expect(g.state.phase).toBe('live'); const b = await open(); b.f.emit('closed', { code: 4401, willReconnect: false }); b.f.emit('closed', { code: 4401, willReconnect: false }); expect(b.g.state.phase).toBe('ended'); });
  it('1001 reconnects after 250 ms plus jitter and the state survives', async () => { const { f, g, c } = await open(); f.emit('closed', { code: 1001, willReconnect: false }); expect(g.state.phase).toBe('reconnecting'); c.advance(249); expect(f.connects()).toBe(1); c.advance(1); await new Promise((r) => setTimeout(r, 5)); expect(f.connects()).toBe(2); expect(g.state.roster).toHaveLength(2); expect(g.state.phase).toBe('live'); });
  it('waits for the key, then decodes the 20 buffered frames in order (acceptance 9)', async () => {
    let haveKey = false; const dec: FrameDecoder = { decode: (x) => (x.ct && !haveKey ? { kind: 'wait_key' } : { kind: 'ok', frame: { ...x, secret: { text: `m${x.seq}` } } as never }) }; const { f, g } = await open('editor', { decoder: dec });
    for (let i = 2; i <= 21; i++) f.emit('frame', { ...sf(i, 'message.user', HOST, {}, 'event'), p: undefined, ct: { alg: 'x', kid: 'k1', n: 'A', c: 'AAAA' } }); expect(g.state.phase).toBe('waiting_for_key'); expect(g.state.transcript).toHaveLength(0); f.emit('frame', sf(22, 'message.system', HOST, {}, 'event')); haveKey = true; g.keyArrived(); expect(g.state.phase).toBe('live'); const texts = g.state.transcript.filter((e) => e.kind === 'user').map((e) => (e as { text: string }).text); expect(texts).toEqual(Array.from({ length: 20 }, (_, i) => `m${i + 2}`)); expect(g.state.transcript.map((e) => e.seq)).toEqual([...g.state.transcript.map((e) => e.seq)].sort((a, b) => a - b));
  });
  it('leave closes the transport and ends; state$ notifies listeners', async () => { const { g } = await open(); const seen: string[] = []; g.state$.subscribe((s) => seen.push(s.phase)); await g.leave(); expect(g.state.phase).toBe('ended'); expect(seen.at(-1)).toBe('ended'); });
});

const stops: (() => Promise<void>)[] = []; afterEach(async () => { for (const s of stops.splice(0).reverse()) await s().catch(() => undefined); });
describe('against the host engine over loopback', () => {
  it('a guest joins, submits, sees the approval and the queue, and survives a forced disconnect with one item only', async () => {
    await initCrypto(); const env = await lanServer(); const engine = new HostSessionEngine({ server: env.server, persistence: createFilePersistence(pjoin(env.dir, 'h')), tokens: new ReconnectTokens(), clock: { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h: never) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) } }); await engine.start(); stops.push(() => engine.stop());
    const kc = memoryKeychain(); const device = new DeviceKeyStore(kc, dev(2)); await device.getOrCreatePublicKeys(); const t = new LanTransport({ host: '127.0.0.1', port: env.port, sessionId: SID, reconnectToken: token('guest-token'), keychain: kc, device, deviceInfo: { id: dev(2), name: 'Guest' }, clientInfo: CLIENT }); const g = await GuestSession.join({ transport: t, decoder: passthrough, clock: { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h: never) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) }, ids: { msg, que }, sealBody, sign, sid: SID }); stops.push(() => g.leave());
    const until = async (fn: () => boolean) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > 3000) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); } };
    await until(() => g.state.phase === 'live'); expect(g.state.me.role).toBe('editor'); const item = await g.submit('do the thing'); await until(() => g.state.queue.items.some((i) => i.item === item)); expect(g.state.queue.items[0]).toMatchObject({ submitter: mem(2), state: 'queued', size: 12 });
    await engine.approveItem(item); await until(() => g.state.queue.items[0]?.state === 'approved'); expect(g.state.queue.version).toBe(engine.queue().version);
    env.server.kickConnection(mem(2), 1001); await until(() => g.state.phase === 'reconnecting' || g.state.phase === 'live'); await until(() => g.state.phase === 'live' && g.state.lastSeq === engine.headSeq()); expect(engine.queue().items).toHaveLength(1);
  }, 20_000);
});
