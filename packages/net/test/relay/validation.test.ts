import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_FRAME_BYTES } from '../../src/index.js';
import { SID, rig } from './helpers.js';

const MARK = 'SECRETPAYLOADMARK';

describe('inbound validation (AC10)', () => {
  it('a frame missing v is dropped, emits protocol_warning, and the connection stays up', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept(); const before = r.ev.frame.length;
    s.receive({ t: 'event', id: 'msg_01JA3Z8K2M5N7P9Q0R1S2T3V4W', sid: SID, k: 'message.user', seq: 1, p: { text: MARK } });
    expect(r.ev.frame).toHaveLength(before); expect(r.ev.protocol_warning).toEqual([{ reason: 'invalid_frame' }]); expect(r.client.invalidFrames).toBe(1);
    expect(r.client.state).toBe('ready'); expect(s.closeCalls).toHaveLength(0);
  });
  it('binary frames, non-JSON and oversize frames are dropped with a reason; unknown types and fields are ignored without a warning', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept();
    s.receive('{"v":1,"t":"sys.ping"}', true); s.receive('{not json'); s.receive(JSON.stringify({ v: 1, t: 'sys.notice', p: { pad: 'x'.repeat(MAX_FRAME_BYTES) } }));
    expect(r.ev.protocol_warning.map((w) => w.reason)).toEqual(['binary_frame', 'not_json', 'oversize']);
    s.receive({ v: 1, t: 'sys.future_thing', p: {} }); s.receive({ v: 1, t: 'sys.notice', p: { code: 'x', level: 'info', params: {} }, brand_new_field: true });
    expect(r.ev.protocol_warning).toHaveLength(3); expect(r.ev.notice).toHaveLength(1); expect(r.ev.frame.at(-1)!.brand_new_field).toBe(true);
    expect(r.client.state).toBe('ready');
  });
  it('a sys.error body becomes a typed C006 error', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept();
    s.receive({ v: 1, t: 'sys.error', p: { type: 'https://centcom.dev/errors/queue_full', title: 'Queue is full', status: 429, code: 'queue_full', request_id: 'req_01JA3Z8K2M5N7P9Q0R1S2T3V4W', retry_after_s: 5 } });
    s.receive({ v: 1, t: 'sys.error', p: { type: 'x', title: 'x', status: 400, code: 'brand_new_code', request_id: 'req_01JA3Z8K2M5N7P9Q0R1S2T3V4W' } });
    expect(r.ev.error.map((e) => [e.name, e.code, e.retryAfterS])).toEqual([['CentcomError', 'queue_full', 5], ['CentcomError', 'unknown', undefined]]);
  });
  it('fuzz: random JSON, random text and random bytes never throw out of the client, never close it, and never reach the logs', async () => {
    const r = rig(); void r.client.connect(); const s = await r.accept();
    const marked = fc.oneof(
      fc.jsonValue().map((j) => JSON.stringify({ v: 1, t: 'event', sid: SID, k: 'message.user', seq: 3, p: { text: MARK, j } })),
      fc.record({ v: fc.constantFrom(1, 2, '1', null), t: fc.constantFrom('event', 'queue', 'sys.ping', 'sys.error', 'sys.welcome', 'sys.resumed', 'presence', 'zzz'), seq: fc.oneof(fc.integer(), fc.string()), p: fc.constant({ text: MARK }), ct: fc.constant({ alg: 'xchacha20poly1305', kid: 'k1', n: 'N'.repeat(32), c: MARK }) }, { requiredKeys: [] }).map((x) => JSON.stringify(x)),
      fc.jsonValue().map((j) => JSON.stringify(j)),
      fc.string().map((x) => x + MARK),
    );
    fc.assert(fc.property(marked, fc.boolean(), (text, binary) => { expect(() => s.receive(text, binary)).not.toThrow(); return r.client.state === 'ready'; }), { seed: 1054, numRuns: 1500 });
    fc.assert(fc.property(fc.uint8Array({ maxLength: 512 }), (bytes) => { expect(() => s.receive(Buffer.from(bytes).toString('latin1'), true)).not.toThrow(); return true; }), { seed: 1055, numRuns: 300 });
    expect(s.closeCalls).toHaveLength(0); expect(r.client.state).toBe('ready'); expect(r.logs()).not.toContain(MARK);
  });
  it('a listener that throws does not break the client or other listeners', async () => {
    const r = rig(); r.client.on('frame', () => { throw new Error(MARK); }); let seen = 0; r.client.on('frame', () => seen++);
    void r.client.connect(); const s = await r.accept(); s.receive({ v: 1, t: 'sys.ping', p: { t: 1 } });
    expect(seen).toBe(2); expect(s.of('sys.pong')).toHaveLength(1); expect(r.logs()).toContain('relay.listener_failed'); expect(r.logs()).not.toContain(MARK);
  });
});
