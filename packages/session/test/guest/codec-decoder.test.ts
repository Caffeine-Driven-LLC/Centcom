import { describe, expect, it } from 'vitest';
import { DeviceKeyStore, FrameCodec, KeyRing, Roster, initCrypto, memoryKeychain, sodium } from '@centcom/net';
import type { Frame } from '@centcom/protocol';
import { GuestSession, codecDecoder, SERVER } from '../../src/index.js';
import { SID, mem } from '../rigs.js';

const HOST = mem(1), ME = mem(2), DEV = 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4W';
const clock = { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined };
let n = 0; const msg = () => `msg_${String(++n).padStart(26, 'A')}`.slice(0, 30);

async function world() {
  await initCrypto(); const dev = new DeviceKeyStore(memoryKeychain(), DEV); const keys = await dev.getOrCreatePublicKeys(); const key = sodium().crypto_aead_xchacha20poly1305_ietf_keygen();
  const hostRing = new KeyRing(); hostRing.addEpoch('k1', key); const guestRing = new KeyRing(); const roster = new Roster(); roster.upsert({ id: HOST, role: 'host', slot: 0, device: DEV, keys: { device: DEV, ...keys } } as never);
  const hostCodec = new FrameCodec({ sid: SID, deviceId: DEV, device: dev, ring: hostRing, roster }); const guestCodec = new FrameCodec({ sid: SID, deviceId: 'dev_guest', device: undefined, ring: guestRing, roster });
  const h: Record<string, ((...a: never[]) => void)[]> = {}; const emit = (ev: string, ...a: unknown[]) => { for (const f of h[ev] ?? []) (f as (...x: unknown[]) => void)(...a); };
  const transport = { kind: 'local', capabilities: {}, state: 'ready', on: (ev: string, fn: (...a: never[]) => void) => { (h[ev] ??= []).push(fn); return () => undefined; }, send: async () => undefined, close: async () => undefined, reconnect: () => undefined, connect: async () => { emit('welcome', { member: { id: ME, name: 'Me', slot: 1, role: 'editor' }, role: 'editor', slot: 1, resume: null, caps: [] }); return {}; } };
  const g = await GuestSession.join({ transport: transport as never, decoder: codecDecoder(guestCodec), clock, ids: { msg, que: msg }, sealBody: async () => ({ alg: 'x', kid: 'k1', n: 'A', c: 'AA' }), sign: async () => 'A'.repeat(86), sid: SID });
  const frame = (seq: number, text: string, tamper = false): Frame => { const id = msg(); const o = hostCodec.encode('message.user', id, { secret: { text, agent_id: 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V4W' } }); return { v: 1, sid: SID, from: HOST, ts: '2026-10-07T00:00:00.000Z', seq, ...o, ...(tamper ? { sig: 'A'.repeat(86) } : {}) } as unknown as Frame; };
  emit('frame', { v: 1, t: 'control', id: msg(), sid: SID, from: SERVER, ts: '2026-10-07T00:00:00.000Z', k: 'control.roster', seq: 1, p: { version: 1, members: [{ id: HOST, name: 'H', slot: 0, role: 'host' }, { id: ME, name: 'Me', slot: 1, role: 'editor' }] } });
  return { g, emit, frame, guestRing, key };
}

describe('the guest engine decodes with the session client codec (C076 wired)', () => {
  it('waits without the key, then shows real decrypted text once the key arrives; a forged signature is dropped and recorded', async () => {
    const { g, emit, frame, guestRing, key } = await world();
    emit('frame', frame(2, 'secret hello')); expect(g.state.phase).toBe('waiting_for_key'); expect(g.state.transcript.some((e) => e.kind === 'user')).toBe(false);
    guestRing.addEpoch('k1', key); g.keyArrived(); expect(g.state.transcript.find((e) => e.kind === 'user')).toMatchObject({ text: 'secret hello' });
    emit('frame', frame(3, 'forged', true)); expect(g.state.transcript.filter((e) => e.kind === 'user')).toHaveLength(1); expect(g.state.warnings.at(-1)).toMatchObject({ reason: 'bad_signature' });
  });
});
