import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GuestIngest, KeyWaitBuffer, SERVER, initialGuestState, reduceGuestState, type DecodedFrame } from '../../src/guest/index.js';

const dir = join(import.meta.dirname, '../../../../contracts/fixtures/events'); const ME = 'mem_AAAAAAAAAAAAAAAAAAAAAAAAA2'; const HOST = 'mem_AAAAAAAAAAAAAAAAAAAAAAAAA1';
let n = 0; const fr = (seq: number, k: string, from: string, p?: Record<string, unknown>, secret?: Record<string, unknown>): DecodedFrame => ({ v: 1, t: k.split('.')[0] === 'queue' ? 'queue' : k.startsWith('control') ? 'control' : 'event', id: `msg_${String(++n).padStart(26, 'A')}`.slice(0, 30), sid: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', from, ts: '2026-10-07T00:00:00.000Z', k, seq, ...(p ? { p } : {}), ...(secret ? { secret } : {}) }) as DecodedFrame;
const roster = (seq = 1) => fr(seq, 'control.roster', SERVER, { version: 1, members: [{ id: HOST, name: 'H', slot: 0, role: 'host' }, { id: ME, name: 'Me', slot: 1, role: 'editor' }] });
const start = () => reduceGuestState(initialGuestState({ member: ME, slot: 1, role: 'editor' }), roster());

describe('reduceGuestState', () => {
  it('folds every fixture event without throwing and returns a state with the same shape', () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) { const j = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { frame: DecodedFrame; secret_payload: Record<string, unknown> | null }; const s = reduceGuestState(start(), { ...j.frame, seq: 50, secret: j.secret_payload }); expect(Object.keys(s).sort(), f).toEqual(Object.keys(start()).sort()); expect(s.lastSeq, f).toBe(50); }
  });
  it('is total: unknown kinds, junk payloads and null fields never throw', () => {
    for (const bad of [fr(5, 'x.future', 'mem_x', { a: 1 }), fr(5, 'message.assistant.delta', 'mem_x', undefined, { index: 'zz' }), { ...fr(5, 'queue.state', SERVER), p: { items: [null, 7, 'x'], version: 'v' } } as DecodedFrame, { seq: 5 } as DecodedFrame, null as never, { ...fr(5, 'control.roster', SERVER), p: { members: 'no' } } as DecodedFrame]) expect(() => reduceGuestState(start(), bad)).not.toThrow();
    const s = reduceGuestState(start(), fr(2, 'x.future', 'mem_x')); expect(s.transcript.at(-1)).toMatchObject({ kind: 'other', frameKind: 'x.future' });
  });
  it('the roster makes the guest live and sets the role (the roster is the authority, not a claim)', () => { const s = start(); expect(s.phase).toBe('live'); expect(s.me.role).toBe('editor'); const d = reduceGuestState(s, fr(2, 'control.roster', SERVER, { version: 2, members: [{ id: ME, name: 'Me', slot: 1, role: 'viewer' }, { id: HOST, name: 'H', slot: 0, role: 'host' }] })); expect(d.me.role).toBe('viewer'); expect(reduceGuestState(d, fr(3, 'control.roster', SERVER, { version: 1, members: [] })).roster).toHaveLength(2); });
  it('control frames that only the server may send are ignored and warned when they come from a member (acceptance 8)', () => {
    for (const k of ['control.member_joined', 'control.member_left', 'control.roster', 'control.host_changed', 'control.session_state', 'control.rotate_key']) { const s = reduceGuestState(start(), fr(2, k, 'mem_evil', { member: ME, state: 'ended', host: 'mem_evil', members: [], version: 9, code: 'x', kid: 'k9', reason: 'x' })); expect(s.warnings.at(-1), k).toMatchObject({ kind: k, reason: 'control_not_from_server' }); expect(s.phase, k).toBe('live'); expect(s.roster, k).toHaveLength(2); }
    const spoof = reduceGuestState(start(), fr(2, 'control.kick', ME, { member: ME, code: 'abuse' })); expect(spoof.phase).toBe('live'); expect(spoof.warnings.at(-1)!.reason).toBe('control_not_from_host'); expect(reduceGuestState(start(), fr(2, 'control.kick', HOST, { member: ME, code: 'abuse' })).phase).toBe('kicked');
    expect(reduceGuestState(start(), fr(2, 'queue.state', 'mem_evil', { version: 5, items: [] })).queue.version).toBe(0);
  });
  it('mute, unmute, role and host change from the host apply to me', () => { let s = reduceGuestState(start(), fr(2, 'control.mute', HOST, { member: ME })); expect(s.me.muted).toBe(true); s = reduceGuestState(s, fr(3, 'control.unmute', HOST, { member: ME })); expect(s.me.muted).toBe(false); s = reduceGuestState(s, fr(4, 'control.role', HOST, { member: ME, role: 'viewer' })); expect(s.me.role).toBe('viewer'); s = reduceGuestState(s, fr(5, 'control.host_changed', SERVER, { host: ME, code: 'transfer' })); expect(s.me.role).toBe('host'); expect(s.roster.find((m) => m.id === HOST)!.role).toBe('editor'); });
  it('assistant deltas render in index order, stall at a gap without blocking others, and finish on done (acceptance 5)', () => {
    const d = (seq: number, index: number, delta: string, mid = 'msg_A') => fr(seq, 'message.assistant.delta', HOST, undefined, { agent_id: 'agt_1', message_id: mid, index, delta }); let s = start(); s = reduceGuestState(s, d(2, 1, 'b')); s = reduceGuestState(s, d(3, 0, 'a')); s = reduceGuestState(s, d(4, 3, 'd')); s = reduceGuestState(s, d(5, 0, 'x', 'msg_B')); const a = s.transcript.find((e) => e.kind === 'assistant' && e.messageId === 'msg_A')!; expect(a).toMatchObject({ text: 'ab', gap: true, done: false }); expect(s.transcript.find((e) => e.kind === 'assistant' && e.messageId === 'msg_B')).toMatchObject({ text: 'x', gap: false });
    s = reduceGuestState(s, d(6, 2, 'c')); s = reduceGuestState(s, fr(7, 'message.assistant.done', HOST, undefined, { agent_id: 'agt_1', message_id: 'msg_A' })); expect(s.transcript.find((e) => e.kind === 'assistant' && e.messageId === 'msg_A')).toMatchObject({ text: 'abcd', gap: false, done: true });
  });
  it('unknown agent states show as working; queue.state replaces the queue only when newer', () => {
    let s = reduceGuestState(start(), fr(2, 'agent.state', HOST, { agent_id: 'agt_1', state: 'quantum-flux', since: 'x' })); expect(s.agents.agt_1!.state).toBe('working'); s = reduceGuestState(s, fr(3, 'agent.state', HOST, { agent_id: 'agt_1', state: 'approved', since: 'x' })); expect(s.agents.agt_1!.state).toBe('approved');
    s = reduceGuestState(s, fr(4, 'queue.state', SERVER, { version: 4, items: [{ item: 'que_1', submitter: ME, state: 'queued', position: 0, size: 3, kind: 'message', ts: 't' }] })); expect(s.queue.items).toHaveLength(1); expect(reduceGuestState(s, fr(5, 'queue.state', SERVER, { version: 3, items: [] })).queue.items).toHaveLength(1);
  });
  it('the warnings ring keeps the last 100', () => { let s = start(); for (let i = 0; i < 150; i++) s = reduceGuestState(s, fr(2 + i, 'control.roster', 'mem_evil', {})); expect(s.warnings).toHaveLength(100); });
});

describe('ordering (acceptance 4)', () => {
  const frames = (): DecodedFrame[] => { const out: DecodedFrame[] = [roster(1)]; for (let i = 2; i <= 200; i++) out.push(i % 3 === 0 ? fr(i, 'message.user', HOST, undefined, { text: `t${i}` }) : i % 3 === 1 ? fr(i, 'message.assistant.delta', HOST, undefined, { agent_id: 'a', message_id: `msg_${i % 5}`, index: Math.floor(i / 5), delta: `d${i}` }) : fr(i, 'agent.state', HOST, { agent_id: 'a', state: 'approved', since: 'x' })); return out; };
  const run = (list: DecodedFrame[]) => { const ing = new GuestIngest<DecodedFrame>(); let s = initialGuestState({ member: ME, slot: 1, role: 'editor' }); for (const f of list) for (const g of ing.push(f)) s = reduceGuestState(s, g); return { s, last: ing.lastSeq }; };
  it('a shuffle with duplicates gives the same state as the in-order run, and lastSeq is the highest contiguous seq', () => {
    const base = run(frames()); fc.assert(fc.property(fc.shuffledSubarray(frames(), { minLength: 200, maxLength: 200 }), fc.array(fc.nat(199), { maxLength: 60 }), (shuf, dups) => { const withDups = [...shuf, ...dups.map((i) => frames()[i]!)]; const r = run(withDups); expect(r.s.transcript.map((e) => [e.seq, e.kind])).toEqual(base.s.transcript.map((e) => [e.seq, e.kind])); expect(r.s.lastSeq).toBe(200); expect(r.last).toBe(200); }), { numRuns: 30 });
  });
  it('lastSeq stops at the first gap and the waiting frames are held', () => { const ing = new GuestIngest<{ seq: number }>(); expect(ing.push({ seq: 1 })).toHaveLength(1); expect(ing.push({ seq: 3 })).toHaveLength(0); expect(ing.lastSeq).toBe(1); expect(ing.waiting).toBe(1); expect(ing.push({ seq: 2 }).map((x) => x.seq)).toEqual([2, 3]); expect(ing.push({ seq: 2 })).toEqual([]); expect(ing.push({ seq: 'x' as never })).toEqual([]); });
});

describe('key wait buffer (acceptance 9)', () => {
  it('keeps 20 frames, and evicts the oldest past the frame or byte cap', () => {
    const f = (seq: number, size = 4) => ({ seq, ct: { c: 'A'.repeat(size) } }) as never; const b = new KeyWaitBuffer(); for (let i = 1; i <= 20; i++) b.push(f(i)); expect(b.size).toBe(20); expect(b.drain().map((x) => x.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const c = new KeyWaitBuffer(3, 1e9); for (let i = 1; i <= 5; i++) c.push(f(i)); expect(c.size).toBe(3); expect(c.evicted).toBe(2); expect(c.drain().map((x) => x.seq)).toEqual([3, 4, 5]); const d = new KeyWaitBuffer(2000, 10); d.push(f(1, 6)); expect(d.push(f(2, 6))).toBe(1); expect(d.size).toBe(1);
  });
});
