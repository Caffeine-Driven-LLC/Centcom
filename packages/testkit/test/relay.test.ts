import { afterEach, describe, expect, it } from 'vitest';
import { ulid as _u } from './ulid.js';
import { Peer, start } from './helpers.js';
import type { MockBackend } from '../src/index.js';

let m: MockBackend; const peers: Peer[] = [];
const open = async (o: Parameters<typeof Peer.open>[1] = {}) => { const p = await Peer.open(m, o); peers.push(p); return p; };
afterEach(async () => { peers.splice(0).forEach((p) => p.close()); await m?.stop(); });
const SID = 'ses_01JTEST0000000000000000001';
const que = (n: number) => `que_${_u(n)}`; const msg = (n: number) => `msg_${_u(n)}`;
const ev = (id: string, text = 'x') => ({ v: 1, t: 'event', id, k: 'message.user', p: { text } });

describe('handshake', () => {
  it('welcome carries limits, heartbeat and the member', async () => {
    m = await start(); const a = await open({ role: 'host', name: 'Ada' }); await a.until((p) => p.has('sys.welcome'));
    const w = a.of('sys.welcome')[0].p; expect(w.protocol).toBe(1); expect(w.heartbeat).toEqual({ ping_ms: 20000, dead_ms: 50000 }); expect(w.member.role).toBe('host'); expect(w.limits.max_frame_bytes).toBe(262144);
  });
  it('no hello within 5 s of virtual time closes 4408', async () => {
    m = await start(); const a = await open({ hello: false }); await m.virtual!.advance(4900); expect(a.closed).toBeUndefined(); await m.virtual!.advance(200); await a.until((p) => !!p.closed); expect(a.closed!.code).toBe(4408);
  });
  it('an expired ticket gets sys.error then 4401', async () => {
    m = await start(); const t = ((await m.control('ticket', { sid: SID })) as { ticket: string }).ticket; await m.virtual!.advance(61_000);
    const a = await open({ ticket: t }); await a.until((p) => !!p.closed); expect(a.has('sys.error')).toBe(true); expect(a.closed!.code).toBe(4401);
  });
  it('a ticket cannot be used twice', async () => {
    m = await start(); const t = ((await m.control('ticket', { sid: SID })) as { ticket: string }).ticket; const a = await open({ ticket: t }); await a.until((p) => p.has('sys.welcome'));
    const b = await open({ ticket: t }); await b.until((p) => !!p.closed); expect(b.closed!.code).toBe(4401); expect(b.of('sys.error')[0].p.code).toBe('ticket_replayed');
  });
  it('a second connection for the same member and device supersedes the first (4409)', async () => {
    const device = 'dev_01JTEST0000000000000000001'; m = await start(); const a = await open({ name: 'Ada', device }); await a.until((p) => p.has('sys.welcome'));
    const b = await open({ name: 'Ada', device }); await b.until((p) => p.has('sys.welcome')); await a.until((p) => !!p.closed);
    expect(a.closed!.code).toBe(4409); expect(a.of('sys.bye')[0].p.reason).toBe('superseded');
    const c = await open({ name: 'Ada', device: 'dev_01JTEST0000000000000000002' }); await c.until((p) => p.has('sys.welcome')); await new Promise((r) => setTimeout(r, 80)); expect(b.closed).toBeUndefined(); // another device of the same member coexists
  });
  it('a wrong first frame, a bad protocol list and garbage are refused', async () => {
    m = await start(); const a = await open({ hello: false }); a.send({ v: 1, t: 'sys.ping', p: {} }); await a.until((p) => !!p.closed); expect(a.closed!.code).toBe(4400);
    const t = ((await m.control('ticket', { sid: SID })) as { ticket: string }).ticket; const b = await open({ hello: false }); b.send({ v: 1, t: 'sys.hello', p: { protocols: [9], ticket: t, caps: [], client: { name: 'x', version: '1.0.0', contract: '1.2.0' }, last_seq: null } }); await b.until((p) => !!p.closed); expect(b.closed!.code).toBe(4400);
  });
  it('heartbeat: pings arrive every 20 s and a silent client is dropped at 50 s', async () => {
    m = await start(); const a = await open({ pong: false }); await a.until((p) => p.has('sys.welcome')); await m.virtual!.advance(20_000); await a.until((p) => p.has('sys.ping'));
    await m.virtual!.advance(41_000); /* 61 s of silence: the 60 s check finds it past dead_ms (50 s) */ await a.until((p) => !!p.closed); expect(a.closed!.code).toBe(1001);
  });
  it('too old a client is told to upgrade (4426)', async () => {
    m = await start(); await m.control('min-client', { version: '9.0.0' }); const a = await open(); await a.until((p) => !!p.closed); expect(a.closed!.code).toBe(4426);
  });
});

describe('sequencing and resume', () => {
  it('three clients see one identical, gap-free order from 1, and a resend does not create a new seq', async () => {
    m = await start(); const a = await open({ role: 'host', name: 'A' }); const b = await open({ name: 'B' }); const c = await open({ name: 'C' });
    await Promise.all([a, b, c].map((p) => p.until((x) => x.has('sys.welcome') && x.seqs().includes(3)))); const base = 3; // everyone has seen the three joins
    for (let i = 0; i < 4; i++) for (const [j, p] of [a, b, c].entries()) p.send(ev(msg(i * 3 + j + 1), `m${i}${j}`));
    await Promise.all([a, b, c].map((p) => p.until((x) => x.seqs().length >= 0 && Math.max(0, ...x.seqs()) >= base + 12)));
    const after = [a, b, c].map((p) => p.seqs().filter((s) => s > base)); expect(after[1]).toEqual(after[0]); expect(after[2]).toEqual(after[0]); expect(after[0]).toEqual(Array.from({ length: 12 }, (_x, i) => base + 1 + i));
    expect(a.seqs()).toEqual(Array.from({ length: 15 }, (_x, i) => i + 1)); // A was there from the start: 1..15 with no gaps
    const total = a.seqs().length; a.send(ev(msg(1), 'again')); await new Promise((r) => setTimeout(r, 150)); expect(Math.max(...a.seqs())).toBe(15); expect(a.seqs().filter((s) => s === 4)).toHaveLength(2); void total; // the resend is answered with the original (same seq), never a new one
  });
  it('resume inside the buffer replays exactly the missing frames then sys.resumed', async () => {
    m = await start(); const a = await open({ role: 'host', name: 'A' }); await a.until((p) => p.has('sys.welcome'));
    for (let i = 1; i <= 6; i++) a.send(ev(msg(i))); await a.until((p) => p.seqs().length >= 7); const last = a.seqs()[2]!; a.close();
    const b = await open({ role: 'host', name: 'A', lastSeq: last }); await b.until((p) => p.has('sys.resumed'));
    const r = b.of('sys.resumed')[0].p; expect(r.from_seq).toBe(last + 1); expect(b.seqs().filter((s) => s > last).length).toBeGreaterThanOrEqual(r.count);
    expect(b.frames.filter((f) => typeof f.seq === 'number' && f.seq <= last)).toHaveLength(0); expect(r.count).toBe(r.to_seq - last);
  });
  it('resume older than the 5000 frame buffer asks for a snapshot', async () => {
    m = await start({ relay: { replayFrames: 10 } }); const a = await open({ role: 'host', name: 'A' }); await a.until((p) => p.has('sys.welcome'));
    for (let i = 1; i <= 30; i++) a.send(ev(msg(i))); await a.until((p) => p.seqs().length >= 31); a.close();
    const b = await open({ role: 'host', name: 'A', lastSeq: 1 }); await b.until((p) => p.has('sys.resumed')); expect(b.of('sys.resumed')[0].p.snapshot_required).toBe(true);
  });
  it('the default replay buffer holds 5000 frames', async () => { m = await start(); expect((await import('../src/index.js')).DEFAULT_RELAY_OPTIONS.replayFrames).toBe(5000); });
  it('a dropped delivery is recovered by resume, a duplicate is harmless, a reorder swaps two frames', async () => {
    m = await start(); const a = await open({ role: 'host', name: 'A' }); await a.until((p) => p.has('sys.welcome'));
    await m.control('fault', { type: 'drop' }); a.send(ev(msg(1))); a.send(ev(msg(2))); await a.until((p) => p.seqs().includes(3)); const s = a.seqs(); expect(new Set(s).size).toBe(s.length);
    expect(s.includes(2)).toBe(false); // seq 2 was lost on the wire (1 is member_joined)
    a.send({ v: 1, t: 'sys.resume', p: { last_seq: 1 } }); await a.until((p) => p.has('sys.resumed')); expect(a.seqs().includes(2)).toBe(true);
    await m.control('fault', { type: 'duplicate' }); a.send(ev(msg(3))); await a.until((p) => p.seqs().filter((x) => x === 4).length === 2);
    await m.control('fault', { type: 'reorder' }); a.send(ev(msg(4))); a.send(ev(msg(5))); await a.until((p) => p.seqs().includes(6)); const tail = a.seqs().slice(-2); expect(tail).toEqual([6, 5]);
  });
});

describe('queue and control', () => {
  it('queue rules: 6th item, non-host approve, finished item, versions increase', async () => {
    m = await start(); const h = await open({ role: 'host', name: 'H' }); const e = await open({ name: 'E' }); await Promise.all([h, e].map((p) => p.until((x) => x.has('sys.welcome'))));
    for (let i = 1; i <= 5; i++) e.send({ v: 1, t: 'queue', id: msg(100 + i), k: 'queue.submit', p: { item: que(i), size: 10, kind: 'message' } });
    await e.until((p) => p.of('queue', 'queue.state').length >= 5); e.send({ v: 1, t: 'queue', id: msg(106), k: 'queue.submit', p: { item: que(6), size: 10, kind: 'message' } });
    await e.until((p) => p.has('sys.error')); expect(e.of('sys.error')[0].p.code).toBe('queue_full'); expect(h.has('sys.error')).toBe(false);
    e.send({ v: 1, t: 'queue', id: msg(50), k: 'queue.approve', p: { item: que(1) } }); await e.until((p) => p.of('sys.error').length >= 2); expect(e.of('sys.error')[1].p.code).toBe('forbidden');
    h.send({ v: 1, t: 'queue', id: msg(51), k: 'queue.approve', p: { item: que(1) } }); h.send({ v: 1, t: 'queue', id: msg(52), k: 'queue.claim', p: { item: que(1), agent_id: 'agt_01JTEST0000000000000000001' } }); h.send({ v: 1, t: 'queue', id: msg(53), k: 'queue.done', p: { item: que(1), outcome: 'ok' } });
    await h.until((p) => p.of('queue', 'queue.state').length >= 8); h.send({ v: 1, t: 'queue', id: msg(54), k: 'queue.approve', p: { item: que(1) } }); await h.until((p) => p.has('sys.error')); expect(h.of('sys.error')[0].p.code).toBe('queue_item_gone'); expect(e.of('sys.error')).toHaveLength(2);
    const versions = h.of('queue', 'queue.state').map((f) => f.p.version); expect(versions).toEqual([...versions].sort((x, y) => x - y)); expect(new Set(versions).size).toBe(versions.length);
  });
  it('kick closes the target with 4403 and is followed by member_left then rotate_key; an editor cannot kick', async () => {
    m = await start(); const h = await open({ role: 'host', name: 'H' }); const e = await open({ name: 'E' }); const v = await open({ name: 'V', role: 'viewer' }); await Promise.all([h, e, v].map((p) => p.until((x) => x.has('sys.welcome')))); await h.until((p) => p.of('control', 'control.member_joined').length >= 3);
    const eid = h.of('control', 'control.member_joined').find((f) => f.p.name === 'E').p.member; const vid = h.of('control', 'control.member_joined').find((f) => f.p.name === 'V').p.member;
    e.send({ v: 1, t: 'control', id: msg(1), k: 'control.kick', p: { member: vid, code: 'abuse' } }); await e.until((p) => p.has('sys.error')); expect(e.of('sys.error')[0].p.code).toBe('forbidden'); expect(v.closed).toBeUndefined();
    h.send({ v: 1, t: 'control', id: msg(2), k: 'control.kick', p: { member: eid, code: 'abuse' } }); await e.until((p) => !!p.closed); expect(e.closed!.code).toBe(4403);
    await h.until((p) => p.has('control', 'control.rotate_key')); const kinds = h.frames.filter((f) => f.t === 'control').map((f) => f.k).slice(-3); expect(kinds).toEqual(['control.kick', 'control.member_left', 'control.rotate_key']);
  });
  it('server-only kinds sent by a client are dropped, viewers cannot send events, and the host can end the session', async () => {
    m = await start(); const h = await open({ role: 'host', name: 'H' }); const v = await open({ name: 'V', role: 'viewer' }); await Promise.all([h, v].map((p) => p.until((x) => x.has('sys.welcome')))); await h.until((p) => p.of('control', 'control.member_joined').length >= 2);
    const before = h.seqs().length; v.send({ v: 1, t: 'queue', id: msg(1), k: 'queue.state', p: { version: 99, items: [] } }); await new Promise((r) => setTimeout(r, 100)); expect(h.seqs().length).toBe(before); expect(v.has('sys.error')).toBe(false);
    v.send(ev(msg(2))); await v.until((p) => p.has('sys.error')); expect(v.of('sys.error')[0].p.code).toBe('role_insufficient');
    v.send({ v: 1, t: 'event', id: msg(9), k: 'comment.add', p: {}, ct: { alg: 'xchacha20poly1305', kid: 'k1', n: 'A'.repeat(32), c: 'AAAA' }, sig: 'B'.repeat(86) }); await v.until((p) => p.seqs().length > 0 && p.frames.some((f) => f.k === 'comment.add')); // viewers may comment
    h.send({ v: 1, t: 'control', id: msg(3), k: 'control.end', p: { code: 'done' } }); await v.until((p) => !!p.closed); expect(v.closed!.code).toBe(1000); expect(h.of('control', 'control.session_state').at(-1).p.state).toBe('ended');
  });
  it('host loss pauses the session after the grace period and host return resumes it', async () => {
    m = await start(); const h = await open({ role: 'host', name: 'H' }); const e = await open({ name: 'E' }); await Promise.all([h, e].map((p) => p.until((x) => x.has('sys.welcome')))); h.close(); await h.until((p) => !!p.closed);
    for (let i = 0; i < 100 && m.relay.connections().length > 1; i++) await new Promise((r) => setTimeout(r, 20)); // the relay arms the host-grace timer in its own onClose: wait for it before advancing the virtual clock
    expect(m.relay.connections()).toHaveLength(1);
    await m.virtual!.advance(601_000); await e.until((p) => p.of('control', 'control.session_state').some((f) => f.p.state === 'paused'));
    const h2 = await open({ role: 'host', name: 'H' }); await e.until((p) => p.of('control', 'control.session_state').some((f) => f.p.state === 'live')); void h2;
  });
});

describe('presence, abuse and backpressure', () => {
  it('presence is coalesced to one update per interval and never echoed to the sender', async () => {
    m = await start(); const a = await open({ role: 'host', name: 'A' }); const b = await open({ name: 'B' }); await Promise.all([a, b].map((p) => p.until((x) => x.has('sys.welcome'))));
    for (let i = 0; i < 6; i++) a.send({ v: 1, t: 'presence', k: 'presence.update', p: { status: 'online', activity: i % 2 ? 'typing' : 'idle' } });
    await new Promise((r) => setTimeout(r, 120)); await m.virtual!.advance(600); await b.until((p) => p.of('presence').length >= 1); expect(b.of('presence')).toHaveLength(1); expect(b.of('presence')[0].p.activity).toBe('typing'); expect(a.of('presence')).toHaveLength(0); expect(b.of('presence')[0].seq).toBeUndefined();
  });
  it('garbage frames: more than 10 a minute closes 4400; one oversized frame is refused without closing', async () => {
    m = await start(); const a = await open({ role: 'host', name: 'A' }); await a.until((p) => p.has('sys.welcome'));
    a.ws.send(JSON.stringify({ v: 1, t: 'event', id: msg(1), k: 'comment.add', p: { text: 'x'.repeat(300_000) } })); await a.until((p) => p.has('sys.error')); expect(a.of('sys.error')[0].p.code).toBe('frame_too_large'); expect(a.closed).toBeUndefined();
    for (let i = 0; i < 11; i++) a.ws.send('not json'); await a.until((p) => !!p.closed); expect(a.closed!.code).toBe(4400);
  });
  it('a client that stops reading is warned once, then closed with 4429', { timeout: 30_000 }, async () => {
    m = await start({ relay: { outboundLimit: 64 * 1024 } }); const h = await open({ role: 'host', name: 'H' }); const slow = await open({ name: 'S', paused: true }); await h.until((p) => p.has('sys.welcome'));
    await new Promise((r) => setTimeout(r, 100)); const big = 'y'.repeat(200_000);
    for (let i = 1; i <= 80 && !slow.closed; i++) { h.send(ev(msg(i), big)); await new Promise((r) => setTimeout(r, 5)); if (i % 10 === 0) (slow.ws as any)._socket.resume(), (slow.ws as any)._socket.pause(); }
    (slow.ws as any)._socket.resume(); await slow.until((p) => !!p.closed, 5000); expect(slow.has('sys.slow_down')).toBe(true); expect(slow.of('sys.slow_down')[0].p.reason).toBe('outbound'); expect(slow.closed!.code).toBe(4429);
  });
  it('the relay can be told to disconnect clients with chosen codes and to push notices', async () => {
    m = await start(); const a = await open({ role: 'host', name: 'A' }); await a.until((p) => p.has('sys.welcome'));
    await m.control('notice', { sid: SID, code: 'usage_warning', level: 'warn', params: { pct: 90, resets_at: '2026-10-07T00:00:00Z' } }); await a.until((p) => p.has('sys.notice')); expect(a.of('sys.notice')[0].p.params.pct).toBe(90);
    await m.control('disconnect', { sid: SID, code: 4503, retry_after_s: 30 }); await a.until((p) => !!p.closed); expect(a.closed!.code).toBe(4503); expect(a.of('sys.error').at(-1).p.retry_after_s).toBe(30);
  });
});
