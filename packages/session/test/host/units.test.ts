import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApprovalBook, HostRoster, LockArbiter, QueueMachine, authorizeFrame, checkControl, createFilePersistence, listSnapshots, type Clock, type Mode, type Role } from '../../src/host/index.js';

const clock = () => { let t = 0; const q: { at: number; fn: () => void; h: number }[] = []; let id = 0; const c: Clock & { advance(ms: number): void } = { now: () => t, setTimeout: (fn, ms) => { const h = ++id; q.push({ at: t + ms, fn, h }); return h; }, clearTimeout: (h: never) => { const i = q.findIndex((x) => x.h === (h as unknown as number)); if (i >= 0) q.splice(i, 1); }, advance(ms) { const end = t + ms; for (;;) { q.sort((a, b) => a.at - b.at); const n = q[0]; if (!n || n.at > end) break; q.shift(); t = n.at; n.fn(); } t = end; } }; return c; };
const A = (role: Role, kind: string, type: string, o: { muted?: boolean; locked?: boolean; mode?: Mode } = {}) => authorizeFrame({ role, kind, type, muted: o.muted ?? false, locked: o.locked ?? false, mode: o.mode ?? 'command_post' });

describe('role matrix (CT-RBAC session actions)', () => {
  const rows: [string, string, Record<Role, 'ok' | 'forbidden'>][] = [
    ['queue.submit', 'queue', { host: 'ok', editor: 'ok', viewer: 'forbidden' }], ['queue.approve', 'queue', { host: 'ok', editor: 'forbidden', viewer: 'forbidden' }], ['queue.reject', 'queue', { host: 'ok', editor: 'forbidden', viewer: 'forbidden' }], ['queue.reorder', 'queue', { host: 'ok', editor: 'forbidden', viewer: 'forbidden' }], ['queue.drop', 'queue', { host: 'ok', editor: 'forbidden', viewer: 'forbidden' }], ['queue.claim', 'queue', { host: 'ok', editor: 'forbidden', viewer: 'forbidden' }], ['queue.done', 'queue', { host: 'ok', editor: 'forbidden', viewer: 'forbidden' }], ['queue.cancel', 'queue', { host: 'ok', editor: 'ok', viewer: 'forbidden' }],
    ['control.kick', 'control', { host: 'ok', editor: 'forbidden', viewer: 'forbidden' }], ['control.mute', 'control', { host: 'ok', editor: 'forbidden', viewer: 'forbidden' }], ['control.role', 'control', { host: 'ok', editor: 'forbidden', viewer: 'forbidden' }], ['control.end', 'control', { host: 'ok', editor: 'forbidden', viewer: 'forbidden' }], ['control.transfer_host', 'control', { host: 'ok', editor: 'forbidden', viewer: 'forbidden' }], ['control.policy', 'control', { host: 'ok', editor: 'forbidden', viewer: 'forbidden' }], ['control.rotate_request', 'control', { host: 'ok', editor: 'forbidden', viewer: 'forbidden' }],
    ['message.user', 'event', { host: 'ok', editor: 'forbidden', viewer: 'forbidden' }], ['agent.state', 'event', { host: 'ok', editor: 'forbidden', viewer: 'forbidden' }], ['file.lock', 'event', { host: 'ok', editor: 'forbidden', viewer: 'forbidden' }],
    ['reaction', 'event', { host: 'ok', editor: 'ok', viewer: 'ok' }], ['comment.add', 'event', { host: 'ok', editor: 'ok', viewer: 'ok' }], ['key.grant', 'event', { host: 'ok', editor: 'ok', viewer: 'forbidden' }], ['approval.decision', 'event', { host: 'ok', editor: 'ok', viewer: 'forbidden' }],
    ['presence.update', 'presence', { host: 'ok', editor: 'ok', viewer: 'ok' }], ['presence.cursor', 'presence', { host: 'ok', editor: 'ok', viewer: 'forbidden' }], ['presence.nudge', 'presence', { host: 'ok', editor: 'ok', viewer: 'forbidden' }],
  ];
  for (const [kind, type, want] of rows) it(`${kind}: host ${want.host}, editor ${want.editor}, viewer ${want.viewer}`, () => { for (const r of ['host', 'editor', 'viewer'] as Role[]) expect(A(r, kind, type), r).toBe(want[r]); });
  it('branch mode lets editors send agent events; a mute stops queue and event frames but not presence; locked blocks editor submits', () => {
    expect(A('editor', 'agent.state', 'event', { mode: 'branch' })).toBe('ok'); expect(A('editor', 'queue.submit', 'queue', { muted: true })).toBe('forbidden'); expect(A('editor', 'reaction', 'event', { muted: true })).toBe('forbidden'); expect(A('editor', 'presence.update', 'presence', { muted: true })).toBe('ok');
    expect(A('editor', 'queue.submit', 'queue', { locked: true })).toBe('forbidden'); expect(A('host', 'queue.submit', 'queue', { locked: true })).toBe('ok'); expect(A('viewer', 'reaction', 'event', { muted: true })).toBe('forbidden'); expect(A('viewer', 'queue.state', 'queue')).toBe('forbidden');
  });
  it('unknown kinds pass for members who may send anything (sequence and forward, never close)', () => { expect(A('editor', 'x.future_kind', 'event')).toBe('ok'); });
});

describe('queue machine', () => {
  const ts = '2026-10-07T00:00:00Z'; const mk = (limit = 20) => new QueueMachine(() => limit); const sub = (q: QueueMachine, id: string, from: string) => { expect(q.check('queue.submit', from, { item: id, size: 10 }, { paused: false })).toEqual({ ok: true }); q.apply('queue.submit', from, { item: id, size: 10, kind: 'message' }, ts); };
  it('submit -> approve -> claim -> done with the version going up on every change', () => {
    const q = mk(); sub(q, 'que_1', 'a'); expect(q.view().items[0]).toMatchObject({ item: 'que_1', state: 'queued', position: 0 }); q.apply('queue.approve', 'host', { item: 'que_1' }, ts); q.apply('queue.claim', 'host', { item: 'que_1', agent_id: 'ag' }, ts); expect(q.view().items[0]).toMatchObject({ state: 'running', position: null, agent_id: 'ag' }); q.apply('queue.done', 'host', { item: 'que_1', outcome: 'ok' }, ts); expect(q.view()).toEqual({ version: 4, items: [] }); expect(q.get('que_1')!.state).toBe('done');
  });
  it('caps: 5 live per member, the policy limit for the session, 192 KiB per item, duplicates are no-ops', () => {
    const q = mk(); for (let i = 0; i < 5; i++) sub(q, `que_${i}`, 'a'); expect(q.check('queue.submit', 'a', { item: 'que_x', size: 1 }, { paused: false })).toEqual({ ok: false, code: 'queue_full' }); expect(q.check('queue.submit', 'b', { item: 'que_y', size: 196_609 }, { paused: false })).toMatchObject({ ok: false, code: 'payload_too_large' }); expect(q.check('queue.submit', 'a', { item: 'que_0', size: 1 }, { paused: false })).toMatchObject({ ok: false, noop: true });
    const s = mk(3); sub(s, 'q1', 'a'); sub(s, 'q2', 'b'); sub(s, 'q3', 'c'); expect(s.check('queue.submit', 'd', { item: 'q4', size: 1 }, { paused: false })).toEqual({ ok: false, code: 'queue_full' });
  });
  it('unknown items are gone; only the submitter cancels; a running item cannot be canceled; approvals pause', () => {
    const q = mk(); expect(q.check('queue.approve', 'h', { item: 'nope' }, { paused: false })).toEqual({ ok: false, code: 'queue_item_gone' }); sub(q, 'q1', 'a'); expect(q.check('queue.cancel', 'b', { item: 'q1' }, { paused: false })).toEqual({ ok: false, code: 'forbidden' }); expect(q.check('queue.approve', 'h', { item: 'q1' }, { paused: true })).toMatchObject({ ok: false }); q.apply('queue.approve', 'h', { item: 'q1' }, ts); q.apply('queue.claim', 'h', { item: 'q1', agent_id: 'g' }, ts); expect(q.check('queue.cancel', 'a', { item: 'q1' }, { paused: false })).toEqual({ ok: false, code: 'queue_item_gone' });
  });
  it('reorder follows frame order and the last one wins; held on host loss shows and clears', () => {
    const q = mk(); for (const i of ['a', 'b', 'c']) { sub(q, i, 'u'); q.apply('queue.approve', 'h', { item: i }, ts); } q.apply('queue.reorder', 'h', { order: ['c', 'a', 'b'] }, ts); expect(q.view().items.map((i) => i.item)).toEqual(['c', 'a', 'b']); q.apply('queue.reorder', 'h', { order: ['b', 'c', 'a'] }, ts); expect(q.view().items.map((i) => i.item)).toEqual(['b', 'c', 'a']);
    expect(q.setHostAway(true)).toBe(true); expect(q.view().items.every((i) => i.state === 'held')).toBe(true); expect(q.setHostAway(true)).toBe(false); q.setHostAway(false); expect(q.view().items[0]!.state).toBe('approved');
  });
  it('two replicas fed the same accepted frames end with the same view (property)', async () => {
    const fc = await import('fast-check'); const ops = fc.array(fc.tuple(fc.constantFrom('queue.submit', 'queue.approve', 'queue.claim', 'queue.done', 'queue.cancel', 'queue.drop', 'queue.reject', 'queue.reorder'), fc.constantFrom('a', 'b', 'c'), fc.constantFrom('u1', 'u2'), fc.array(fc.constantFrom('a', 'b', 'c'), { maxLength: 3 })), { maxLength: 40 });
    fc.assert(fc.property(ops, (list) => { const run = () => { const q = mk(); for (const [k, item, who, order] of list) { const p = { item, size: 5, kind: 'message', agent_id: 'g', outcome: 'ok', order }; if (q.check(k, who, p, { paused: false }).ok) q.apply(k, who, p, ts); } return q.view(); }; expect(run()).toEqual(run()); }), { numRuns: 100 });
  });
});

describe('control checks', () => {
  const r = new HostRoster({ id: 'h', name: 'H', slot: 0, role: 'host' }); r.connected({ memberId: 'e', deviceId: 'd', name: 'E', role: 'editor', slot: 1 } as never); r.connected({ memberId: 'v', deviceId: 'd2', name: 'V', role: 'viewer', slot: 2 } as never);
  it('is strict about targets and values', () => {
    expect(checkControl('control.kick', { member: 'e', code: 'abuse' }, r, 'h')).toEqual({ ok: true }); expect(checkControl('control.kick', { member: 'h', code: 'abuse' }, r, 'h')).toMatchObject({ ok: false }); expect(checkControl('control.kick', { member: 'zz', code: 'abuse' }, r, 'h')).toMatchObject({ code: 'not_a_member' }); expect(checkControl('control.kick', { member: 'e', code: 'bogus' }, r, 'h')).toMatchObject({ code: 'invalid_frame' });
    expect(checkControl('control.role', { member: 'v', role: 'host' }, r, 'h')).toMatchObject({ code: 'invalid_frame' }); expect(checkControl('control.transfer_host', { to: 'v' }, r, 'h')).toMatchObject({ code: 'forbidden' }); expect(checkControl('control.transfer_host', { to: 'e' }, r, 'h')).toEqual({ ok: true }); expect(checkControl('control.end', { code: 'done' }, r, 'h')).toEqual({ ok: true }); expect(checkControl('control.end', { code: 'x' }, r, 'h')).toMatchObject({ ok: false });
  });
  it('roster keeps stable slots and a version', () => { const before = r.version; r.disconnected('e'); expect(r.version).toBe(before + 1); expect(r.get('e')!.slot).toBe(1); expect(r.frame().members.map((m) => m.slot)).toEqual([0, 1, 2]); });
});

describe('lock arbiter (acceptance 9)', () => {
  it('first acquire wins, the second is denied, a release frees it, a ttl expires with a callback at the deadline', () => {
    const c = clock(); const expired: string[] = []; const l = new LockArbiter(c, (x) => expired.push(x.pathHmac)); expect(l.acquire('p1', 'ag1', 'm1', 1000)).toBe('granted'); expect(l.acquire('p1', 'ag2', 'm2', 1000)).toBe('denied'); expect(l.acquire('p1', 'ag1', 'm1', 1000)).toBe('granted'); c.advance(999); expect(expired).toEqual([]); c.advance(1); expect(expired).toEqual(['p1']); expect(l.acquire('p1', 'ag2', 'm2', 5000)).toBe('granted'); expect(l.release('p1', 'ag1', 'm1')).toBe(false); expect(l.release('p1', 'ag2', 'm2')).toBe(true); expect(l.list()).toEqual([]);
  });
  it('a member that is gone loses its locks', () => { const c = clock(); const l = new LockArbiter(c, () => undefined); l.acquire('p1', 'a', 'm1', 9e6); l.acquire('p2', 'b', 'm2', 9e6); expect(l.dropMember('m1').map((x) => x.pathHmac)).toEqual(['p1']); expect(l.list()).toHaveLength(1); l.stop(); });
});

describe('approvals', () => {
  it('first decision wins, expired and unknown are refused, viewers never decide, the requester cannot approve its own request', () => {
    let now = 0; const b = new ApprovalBook(() => now); b.open({ approvalId: 'a1', requester: 'e', approver: 'host', expiresAtMs: 100, decided: false }); expect(b.check('a1', 'h', 'host', [])).toBe('ok'); expect(b.check('a1', 'v', 'viewer', [])).toBe('forbidden'); expect(b.check('a1', 'e', 'editor', [])).toBe('forbidden'); expect(b.check('a1', 'x', 'editor', ['x'])).toBe('ok'); expect(b.check('nope', 'h', 'host', [])).toBe('unknown'); b.markDecided('a1'); expect(b.check('a1', 'h', 'host', [])).toBe('decided'); b.open({ approvalId: 'a2', requester: 'e', approver: 'host', expiresAtMs: 100, decided: false }); now = 101; expect(b.check('a2', 'h', 'host', [])).toBe('expired');
  });
});

describe('history (acceptance 10, 12)', () => {
  it('appends and replays frames in order after a seq; snapshots keep the latest 3', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cc-hist-')); const p = createFilePersistence(root); for (let i = 1; i <= 10; i++) await p.appendFrame('ses_1', { t: 'event', k: 'reaction', seq: i } as never); const got: number[] = []; for await (const f of p.readFrames('ses_1', 4, 3)) got.push(f.seq); expect(got).toEqual([5, 6, 7]);
    for (const s of [100, 200, 300, 400, 500]) await p.saveSnapshot('ses_1', { seq: s, bytes: new Uint8Array([s % 256]) }); expect((await listSnapshots(root, 'ses_1')).length).toBe(3); expect((await p.latestSnapshot('ses_1'))!.seq).toBe(500); expect(await p.latestSnapshot('ses_none')).toBeNull();
  });
});
