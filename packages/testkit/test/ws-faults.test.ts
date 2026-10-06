import { afterEach, describe, expect, it } from 'vitest';
import { CLOSE_CODES, DEFAULT_SID, type MockBackend } from '../src/index.js';
import { Peer, sealed, start } from './helpers.js';
import { ulid } from './ulid.js';

let m: MockBackend; const peers: Peer[] = [];
const open = async (o: Parameters<typeof Peer.open>[1] = {}) => { const p = await Peer.open(m, { sid: DEFAULT_SID, ...o }); peers.push(p); await p.until((x) => x.has('sys.welcome')); return p; };
afterEach(async () => { peers.splice(0).forEach((p) => p.close()); await m?.stop(); });
const msg = (n: number) => `msg_${ulid(n)}`;
const invalidErrors = (p: Peer) => p.of('sys.error').filter((f) => f.p.code === 'invalid_frame');

describe('bad frames (AC9)', () => {
  it('11 invalid frames within 60 virtual seconds give exactly 10 sys.error invalid_frame, then close 4400', async () => {
    m = await start(); const a = await open({ role: 'host', name: 'A' });
    for (let i = 0; i < 10; i++) { a.ws.send(i % 2 ? 'not json' : JSON.stringify({ v: 1, t: 'sys.welcome' })); await m.advance(5000); }
    await a.until((p) => invalidErrors(p).length === 10); expect(a.closed).toBeUndefined(); /* 50 virtual seconds so far, still inside the window */
    a.ws.send('{"v":2}'); await a.until((p) => !!p.closed);
    expect(a.closed!.code).toBe(4400); expect(invalidErrors(a)).toHaveLength(10); expect(a.of('sys.error')).toHaveLength(10);
  });
  it('invalid frames spread over more than 60 virtual seconds never close the socket', async () => {
    m = await start(); const a = await open({ role: 'host', name: 'A' });
    for (let i = 0; i < 15; i++) { a.ws.send('nope'); await a.until((p) => invalidErrors(p).length === i + 1); await m.advance(7000); }
    expect(a.closed).toBeUndefined(); expect(invalidErrors(a)).toHaveLength(15);
  });
  it('an unknown k is sequenced and forwarded to everyone without an error', async () => {
    m = await start(); const a = await open({ role: 'host', name: 'A' }); const b = await open({ name: 'B' });
    a.send({ v: 1, t: 'event', id: msg(1), k: 'future.thing', p: { x: 1 } }); a.send({ v: 1, t: 'event', id: msg(2), k: 'future.sealed', ct: sealed(msg(2)).ct, sig: 'S'.repeat(86) });
    await b.until((p) => p.has('event', 'future.sealed'));
    const got = b.of('event').filter((f) => f.k?.startsWith('future.')); expect(got.map((f) => f.k)).toEqual(['future.thing', 'future.sealed']); expect(got.every((f) => typeof f.seq === 'number')).toBe(true);
    await a.until((p) => p.has('event', 'future.sealed')); expect(a.has('sys.error')).toBe(false); expect(b.has('sys.error')).toBe(false);
    expect(m.frames(DEFAULT_SID).filter((f) => f.k?.startsWith('future.')).map((f) => f.k)).toEqual(['future.thing', 'future.sealed']);
  });
});

describe('forced disconnects', () => {
  const EXPECTED_ERROR: Record<number, string | undefined> = { 1000: undefined, 1001: undefined, 4400: 'protocol_violation', 4401: 'ticket_invalid', 4403: 'forbidden', 4404: 'session_not_found', 4408: undefined, 4409: undefined, 4426: 'client_too_old', 4429: 'rate_limited', 4503: 'service_unavailable' };
  it('every close code in the contract table can be forced, preceded by the matching sys.error (and 4409 by sys.bye superseded)', async () => {
    m = await start();
    for (const code of CLOSE_CODES) {
      const a = await open({ name: `C${code}` }); m.disconnect({ sid: DEFAULT_SID, member: a.of('sys.welcome')[0].p.member.id, code, retryAfterS: 9 }); await a.until((p) => !!p.closed);
      expect(a.closed!.code, String(code)).toBe(code); expect(a.of('sys.error').at(-1)?.p.code, String(code)).toBe(EXPECTED_ERROR[code]);
      if (code === 4429 || code === 4503) expect(a.of('sys.error').at(-1).p.retry_after_s).toBe(9);
      if (code === 4409) expect(a.of('sys.bye')[0].p.reason).toBe('superseded');
    }
  });
  it('can target by role, and a kick through disconnect removes the member like control.kick', async () => {
    m = await start(); const h = await open({ role: 'host', name: 'H' }); const e = await open({ name: 'E' }); const v = await open({ name: 'V', role: 'viewer' });
    m.disconnect({ sid: DEFAULT_SID, role: 'viewer', code: 4403, reason: 'kicked' }); await v.until((p) => !!p.closed);
    expect(v.closed!.code).toBe(4403); expect(v.of('sys.bye')[0].p.reason).toBe('kicked'); expect(e.closed).toBeUndefined(); expect(h.closed).toBeUndefined();
    await h.until((p) => p.has('control', 'control.rotate_key')); const tail = h.frames.filter((f) => typeof f.seq === 'number').slice(-2);
    expect(tail.map((f) => f.k)).toEqual(['control.member_left', 'control.rotate_key']); expect(tail[1].seq).toBe(tail[0].seq + 1);
  });
});

describe('delivery faults', () => {
  it('delay holds a frame for the given virtual time and count applies a fault to several frames', async () => {
    m = await start(); const a = await open({ role: 'host', name: 'A' });
    m.relay.addFault({ type: 'delay', ms: 2000 }); a.send(sealed(msg(1))); await new Promise((r) => setTimeout(r, 80)); expect(a.frames.some((f) => f.id === msg(1))).toBe(false);
    await m.advance(2000); await a.until((p) => p.frames.some((f) => f.id === msg(1)));
    m.relay.addFault({ type: 'duplicate', count: 2 }); a.send(sealed(msg(2))); a.send(sealed(msg(3))); a.send(sealed(msg(4)));
    await a.until((p) => p.frames.some((f) => f.id === msg(4))); await new Promise((r) => setTimeout(r, 50));
    expect([2, 3, 4].map((n) => a.frames.filter((f) => f.id === msg(n)).length)).toEqual([2, 2, 1]);
  });
});
