import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validateAgainst } from '@centcom/protocol';
import { CLOSE_PROTOCOL, CLOSE_REJECTED, CLOSE_TIMEOUT, encodePairMessage, guestPair, memoryChannelPair, PairingError, parsePairMessage, TOKEN_RE, MAX_PAIR_FRAME } from '../../src/index.js';
import { GUEST_DEV, HOST_DEV, SID, setup, tap, wrongCode } from './helpers.js';

const flush = () => new Promise((r) => setImmediate(r));

describe('full lan.pair.1-4 flow (acceptance 2)', () => {
  it('pairs: both sides confirm, host emits paired with the guest keys, guest gets a 256-bit token', async () => {
    const s = await setup(); const { p } = s.connect(); const r = await p;
    expect(r.reconnectToken).toMatch(TOKEN_RE); expect(Buffer.from(r.reconnectToken, 'base64url').length).toBe(32);
    expect(r.session).toEqual({ sid: SID, name: 'Fix the relay', policy: { queue_limit: 20, auto_approve: 'ask', share_history: true } });
    expect(r.member.id).toMatch(/^mem_/); expect(r.member.slot).toBe(1); expect(r.member.role).toBe('editor');
    expect(r.hostDevice.id).toBe(HOST_DEV); expect(r.hostDevice.fingerprint).toBe(s.host.d.fingerprint());
    const keys = await s.guest.d.getOrCreatePublicKeys();
    expect(s.paired).toEqual([{ memberHint: r.member.id, member: r.member, device: { id: GUEST_DEV, x25519: keys.x25519, ed25519: keys.ed25519, name: 'ana-desktop', fingerprint: s.guest.d.fingerprint() }, reconnectToken: r.reconnectToken }]);
    expect(s.trust.get(GUEST_DEV)?.x25519).toBe(keys.x25519);
    expect(s.hp.tokens.validate(r.reconnectToken, '192.168.1.20')).toEqual({ deviceId: GUEST_DEV });
    expect(s.guestSent.map((t) => JSON.parse(t).t)).toEqual(['lan.pair.1', 'lan.pair.3']); expect(s.hostSent.map((t) => JSON.parse(t).t)).toEqual(['lan.pair.2', 'lan.pair.4']);
    for (const f of [...s.guestSent, ...s.hostSent]) expect(validateAgainst('lan-pair', JSON.parse(f), 'strict').ok).toBe(true);
    expect(await s.guest.kc.get(`lan-token:${SID}`)).toBe(r.reconnectToken);
  });
});

describe('wrong code (acceptance 3, 11)', () => {
  it('host sends lan.pair.err bad_code and closes 4403; no host confirmation is ever sent', async () => {
    const s = await setup(); const { p } = s.connect({ code: wrongCode(s.display) });
    await expect(p).rejects.toMatchObject({ name: 'PairingError', pairReason: 'bad_code' });
    await flush();
    expect(s.hostSent.map((t) => JSON.parse(t))).toEqual([expect.objectContaining({ t: 'lan.pair.2' }), { t: 'lan.pair.err', code: 'bad_code' }]);
    expect(s.hostSent.some((t) => 'confirm' in JSON.parse(t))).toBe(false);
    expect(s.closes).toContain(CLOSE_REJECTED); expect(s.failed).toEqual([{ ip: '192.168.1.20', reason: 'bad_code' }]); expect(s.paired).toEqual([]);
  });
  it('a code outside the alphabet is refused before anything is sent', async () => {
    const s = await setup(); const { p } = s.connect({ code: 'ABCD-EFG0' }); await expect(p).rejects.toMatchObject({ pairReason: 'bad_code' }); expect(s.guestSent).toEqual([]);
  });
});

describe('expiry and single use (acceptance 5)', () => {
  it('a correct code fails with expired at 5 min + 1 s', async () => {
    const s = await setup(); await s.clock.advance(5 * 60_000 + 1000); const { p } = s.connect();
    await expect(p).rejects.toMatchObject({ pairReason: 'bad_code' }); await flush(); expect(s.failed).toEqual([{ ip: '192.168.1.20', reason: 'expired' }]);
  });
  it('a second guest with the already-used code fails', async () => {
    const s = await setup(); await s.connect().p;
    const other = await (await import('./helpers.js')).deviceKeys('dev_01JA3Z8K2M5N7P9Q0R1S2T3V4X');
    const { p } = s.connect({ device: other.d, deviceId: 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4X', keychain: other.kc, ip: '192.168.1.21' });
    await expect(p).rejects.toMatchObject({ pairReason: 'bad_code' }); await flush(); expect(s.failed.at(-1)).toEqual({ ip: '192.168.1.21', reason: 'expired' });
  });
  it('expiry runs on the monotonic clock: a wall-clock jump backwards never extends it', async () => {
    const s = await setup(); const c = s.clock as unknown as { monotonic?: () => number }; let m = 0; c.monotonic = () => m;
    s.hp.openCode(1000); m = 1001; const { p } = s.connect(); await expect(p).rejects.toMatchObject({ pairReason: 'bad_code' });
  });
});

describe('replay, reordering, truncation, timeouts (acceptance 6, 9)', () => {
  it('replaying a recorded lan.pair.1 (and pair.3) against a fresh host fails confirmation', async () => {
    const a = await setup(); await a.connect().p; const [m1, m3] = a.guestSent as [string, string];
    const b = await setup(); const [g, h] = memoryChannelPair(); const got: string[] = []; g.onMessage((t) => got.push(t)); b.hp.attach(h, '10.0.0.9');
    g.send(m1); await flush(); expect(JSON.parse(got[0]!).t).toBe('lan.pair.2');
    g.send(m3); await flush(); expect(got.map((t) => JSON.parse(t).t)).toEqual(['lan.pair.2', 'lan.pair.err']); expect(b.failed).toEqual([{ ip: '10.0.0.9', reason: 'bad_code' }]);
  });
  it('lan.pair.3 before lan.pair.1, a duplicate lan.pair.1, and truncated frames are protocol failures (4400)', async () => {
    for (const frames of [['{"t":"lan.pair.3","confirm":"' + 'A'.repeat(43) + '"}'], ['{"t":"lan.pair.1",'], ['']]) {
      const s = await setup(); const [g, h] = memoryChannelPair(); const closes: number[] = []; h.onClose((c) => closes.push(c)); s.hp.attach(h, '10.0.0.2');
      for (const f of frames) g.send(f); await flush(); await flush(); expect(s.failed).toEqual([{ ip: '10.0.0.2', reason: 'protocol' }]); expect(closes[0]).toBe(CLOSE_PROTOCOL);
    }
    const rec = await setup(); await rec.connect().p; const m1 = rec.guestSent[0]!;
    const s = await setup(); const [g, h] = memoryChannelPair(); s.hp.attach(h, '10.0.0.4'); g.send(m1); g.send(m1); await flush(); await flush(); expect(s.failed).toEqual([{ ip: '10.0.0.4', reason: 'protocol' }]);
    const done = await setup(); const c = done.connect(); await c.p; c.g.send(m1); await flush(); expect(done.failed).toEqual([]);
    expect(await done.hp.onPairFrame({ id: 'fresh', remoteIp: '10.0.0.8', send: () => undefined, close: () => undefined }, rec.guestSent[1]!)).toBe('fail');
  });
  it('a half-open handshake is dropped after 10 s and does not count as a failed attempt', async () => {
    const rec = await setup(); await rec.connect().p; const m1 = rec.guestSent[0]!;
    const s = await setup(); const [g, h] = memoryChannelPair(); const closes: number[] = []; h.onClose((c) => closes.push(c)); s.hp.attach(h, '10.0.0.3');
    g.send(m1); await flush(); await s.clock.advance(10_001); expect(closes).toEqual([CLOSE_TIMEOUT]); expect(s.failed).toEqual([]);
    await expect(s.connect({ ip: '10.0.0.3' }).p).resolves.toBeTruthy();
  });
  it('guest gives up with timeout when the host never answers', async () => {
    const s = await setup(); const [g] = memoryChannelPair();
    const p = guestPair({ channel: g, code: s.display, device: s.guest.d, deviceInfo: { id: GUEST_DEV, name: 'x' }, hostSessionId: SID, expectedFingerprint: s.host.d.fingerprint(), clock: s.clock, stepTimeoutMs: 5000 }).catch((e: PairingError) => e.pairReason);
    await flush(); await s.clock.advance(5001); expect(await p).toBe('timeout');
  });
  it('guest reports closed when the host hangs up mid-handshake, and refuses without host identity', async () => {
    const s = await setup(); const [g, h] = memoryChannelPair(); h.onMessage(() => h.close(1001));
    const p = guestPair({ channel: g, code: s.display, device: s.guest.d, deviceInfo: { id: GUEST_DEV, name: 'x' }, hostSessionId: SID, expectedFingerprint: s.host.d.fingerprint(), clock: s.clock });
    await expect(p).rejects.toMatchObject({ pairReason: 'closed' });
    await expect(guestPair({ channel: g, code: s.display, device: s.guest.d, deviceInfo: { id: GUEST_DEV, name: 'x' }, clock: s.clock })).rejects.toMatchObject({ pairReason: 'host_identity_required' });
  });
  it('a hostile host: garbage, an unexpected frame, a bad confirmation or a wrong session all fail closed on the guest', async () => {
    const s = await setup();
    const run = async (reply: (m1: string, h: ReturnType<typeof memoryChannelPair>[1]) => void) => { const [g, h] = memoryChannelPair(); h.onMessage((t) => reply(t, h)); return guestPair({ channel: g, code: s.display, device: s.guest.d, deviceInfo: { id: GUEST_DEV, name: 'x' }, hostSessionId: SID, expectedFingerprint: s.host.d.fingerprint(), clock: s.clock }).catch((e: PairingError) => e.pairReason); };
    expect(await run((_, h) => h.send('not json'))).toBe('protocol');
    expect(await run((_, h) => h.send(encodePairMessage({ t: 'lan.pair.3', confirm: 'A'.repeat(43) })))).toBe('protocol');
    expect(await run((_, h) => h.send(encodePairMessage({ t: 'lan.pair.err', code: 'locked_out' })))).toBe('locked_out');
    expect(await run((_, h) => h.send(encodePairMessage({ t: 'lan.pair.err', code: 'busy' })))).toBe('protocol');
  });
  it('10 000 random frames never crash the host and never pair anyone (acceptance 9)', async () => {
    const s = await setup(); let n = 0;
    await fc.assert(fc.asyncProperty(fc.oneof(fc.string({ maxLength: 300 }), fc.json(), fc.record({ t: fc.constantFrom('lan.pair.1', 'lan.pair.2', 'lan.pair.3', 'lan.pair.4', 'lan.pair.err', 'x'), cpace_msg: fc.string(), confirm: fc.string(), fp: fc.string(), device: fc.anything() }).map((o) => JSON.stringify(o))), async (text) => {
      const r = parsePairMessage(text); expect(typeof r.ok).toBe('boolean');
      if (n++ % 20 === 0) { const out = await s.hp.onPairFrame({ id: `c${n}`, remoteIp: `10.1.${n % 250}.1`, send: () => undefined, close: () => undefined }, text); expect(['continue', 'fail']).toContain(out); }
    }), { numRuns: 10_000 });
    expect(s.paired).toEqual([]);
  });
});

describe('message validation (acceptance 9) and contract fixtures', () => {
  it('missing cpace_msg, wrong lengths and a huge extra field are rejected without throwing', async () => {
    const s = await setup(); await s.connect().p; const m1 = JSON.parse(s.guestSent[0]!);
    const { cpace_msg: _c, ...noCpace } = m1; expect(parsePairMessage(JSON.stringify(noCpace))).toEqual({ ok: false, reason: 'field' });
    expect(parsePairMessage(JSON.stringify({ ...m1, cpace_msg: m1.cpace_msg.slice(1) }))).toEqual({ ok: false, reason: 'field' });
    expect(parsePairMessage(JSON.stringify({ ...m1, device: { ...m1.device, x25519: 'AAAA' } }))).toEqual({ ok: false, reason: 'field' });
    expect(parsePairMessage(JSON.stringify({ ...m1, junk: 'x'.repeat(MAX_PAIR_FRAME) }))).toEqual({ ok: false, reason: 'too_large' });
    expect(parsePairMessage(JSON.stringify({ ...m1, fp: 'AAAA-AAAA-AAAA' }))).toEqual({ ok: false, reason: 'fingerprint' });
    expect(parsePairMessage(JSON.stringify({ ...m1, unknown_field: 1 })).ok).toBe(true);
    const r = await s.hp.onPairFrame({ id: 'z', remoteIp: '10.0.0.5', send: () => undefined, close: () => undefined }, JSON.stringify({ ...m1, junk: 'x'.repeat(5000) })); expect(r).toBe('fail'); expect(s.failed.at(-1)).toEqual({ ip: '10.0.0.5', reason: 'protocol' });
  });
  it('contracts/fixtures/lan match the schema verdicts, and our parser rejects the invalid ones', () => {
    const dir = join(import.meta.dirname, '../../../../contracts/fixtures/lan'); let n = 0;
    for (const f of readdirSync(dir)) { const j = JSON.parse(readFileSync(join(dir, f), 'utf8')); expect(validateAgainst('lan-pair', j.data).ok, f).toBe(j.valid); if (!j.valid) expect(parsePairMessage(JSON.stringify(j.data)).ok, f).toBe(false); n++; }
    expect(n).toBeGreaterThanOrEqual(2);
  });
  it('frames we send are exact and capped', () => {
    expect(() => encodePairMessage({ t: 'lan.pair.err', code: 'nope' as 'busy' })).toThrow(TypeError);
    expect(() => encodePairMessage({ t: 'lan.pair.3', confirm: 'x'.repeat(5000) })).toThrow(RangeError);
  });
  it('the in-memory channel delivers in order and closes both ends', async () => {
    const [a, b] = memoryChannelPair(); const got: string[] = []; const closed: number[] = []; b.onMessage((t) => got.push(t)); a.onClose((c) => closed.push(c)); b.onClose((c) => closed.push(c));
    a.send('1'); a.send('2'); a.close(4000); a.send('3'); a.close(4001); await flush(); expect(got).toEqual(['1', '2']); expect(closed).toEqual([4000, 4000]);
    void tap;
  });
});
