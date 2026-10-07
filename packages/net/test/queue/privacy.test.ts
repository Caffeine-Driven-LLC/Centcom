import { describe, expect, it } from 'vitest';
import { DeviceKeyStore, FrameCodec, KeyRing, Roster, initCrypto, memoryKeychain, hostControls, ItemGoneError, NotAllowedError, QueueFullError, QueueItemTooLargeError, SessionError, CentcomError, mapError } from '../../src/index.js';

describe('privacy: bodies and notes only inside ct', () => {
  it('queue.submit and queue.reject put text in ct only; the clear p holds ids, size, kind and code', async () => {
    await initCrypto(); const dev = new DeviceKeyStore(memoryKeychain(), 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4W'); await dev.getOrCreatePublicKeys(); const codec = new FrameCodec({ sid: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', deviceId: 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4W', device: dev, ring: KeyRing.create(), roster: new Roster() });
    const sub = codec.encode('queue.submit', 'msg_01JA3Z8K2M5N7P9Q0R1S2T3V4W', { p: ({ ctBytes }) => ({ item: 'que_01JA3Z8K2M5N7P9Q0R1S2T3V4W', size: ctBytes, kind: 'command' }), secret: { body: 'SECRET-BODY-TEXT', attachments: [{ name: 'secret-file-name.ts' }] } });
    const rej = codec.encode('queue.reject', 'msg_01JA3Z8K2M5N7P9Q0R1S2T3V5X', { p: { item: 'que_01JA3Z8K2M5N7P9Q0R1S2T3V4W', code: 'other' }, secret: { note: 'SECRET-NOTE-TEXT' } });
    for (const f of [sub, rej]) { const wire = JSON.stringify(f); expect(wire).not.toContain('SECRET-'); expect(wire).not.toContain('secret-file-name'); expect(f.ct?.alg).toBe('xchacha20poly1305'); } expect(Object.keys(sub.p!).sort()).toEqual(['item', 'kind', 'size']); expect(Object.keys(rej.p!).sort()).toEqual(['code', 'item']);
  });
  it('the host moves are clear frames with ids and enums only', async () => {
    const sent: { k: string; body: unknown }[] = []; const c = hostControls({ sendEvent: async (k, body) => { sent.push({ k, body }); return { id: 'msg_x', seq: 1 }; } }); await c.approve('que_a'); await c.reorder(['que_a', 'que_b']); await c.drop('que_a'); await c.claim('que_a', 'agt_x'); await c.done('que_a', 'ok'); await c.reject('que_a', 'unsafe');
    expect(sent.map((s) => s.k)).toEqual(['queue.approve', 'queue.reorder', 'queue.drop', 'queue.claim', 'queue.done', 'queue.reject']); expect(JSON.stringify(sent.slice(0, 5))).not.toMatch(/secret/);
  });
});
describe('server answers become the right errors', () => {
  it('queue_full, queue_item_gone, forbidden and a too-large message', () => {
    const api = (code: string) => new CentcomError({ kind: 'api', code: code as never, status: 400 }); expect(mapError(api('queue_full'))).toBeInstanceOf(QueueFullError); expect(mapError(api('queue_item_gone'))).toBeInstanceOf(ItemGoneError); for (const c of ['forbidden', 'role_insufficient', 'muted', 'session_locked']) expect(mapError(api(c))).toBeInstanceOf(NotAllowedError);
    expect(mapError(new SessionError('too_large', 'x'))).toBeInstanceOf(QueueItemTooLargeError); const other = new Error('boom'); expect(mapError(other)).toBe(other); expect(mapError(api('internal_error'))).toBeInstanceOf(CentcomError);
  });
});
