import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ConflictStore, cardState, fileLabel, secondsLeft, type ConflictEvent } from '../../src/conflicts/index.js';

const T0 = Date.UTC(2026, 9, 7, 12); const iso = (ms = 0) => new Date(T0 + ms).toISOString(); const H = 'ab12cdef'.repeat(5);
const lock = (seq: number, action: string, agent: string, o: { from?: string; ttl?: number; path?: string; at?: number; hmac?: string } = {}): ConflictEvent => ({ kind: 'file.lock', seq, from: o.from ?? `mem_${agent}`, ts: iso(o.at ?? seq * 10), p: { action, path_hmac: o.hmac ?? H, agent_id: agent, ...(o.ttl ? { ttl_ms: o.ttl } : {}) }, ...(o.path ? { secret: { path: o.path } } : {}) });
const conflict = (seq: number, agents = ['a1', 'a2'], hm = [H], paths?: string[]): ConflictEvent => ({ kind: 'conflict.detected', seq, from: 'mem_x', ts: iso(seq), p: { agent_ids: agents, path_hmacs: hm }, ...(paths ? { secret: { paths } } : {}) });
const agentState = (seq: number, agent: string, state: string): ConflictEvent => ({ kind: 'agent.state', seq, from: 'mem_x', ts: iso(seq), p: { agent_id: agent, state, since: iso(seq) } });

describe('locks (acceptance 1, 2)', () => {
  it('acquire then deny: the holder holds, the second agent waits, and the countdown comes from ttl_ms', () => {
    const s = new ConflictStore({ now: () => T0 }); s.apply(lock(1, 'acquire', 'a1', { ttl: 30_000, at: 0, path: 'src/a.ts' })); s.apply(lock(2, 'deny', 'a2', { at: 100 }));
    const [l] = s.getSnapshot().locks; expect(l).toMatchObject({ holder: 'mem_a1', agent: 'a1', waiting: ['a2'], displayPath: 'src/a.ts', expiresAt: T0 + 30_000 }); expect(secondsLeft(l!.expiresAt, T0 + 1000)).toBe(29); expect(secondsLeft(l!.expiresAt, T0 + 29_001)).toBe(1); expect(secondsLeft(l!.expiresAt, T0 + 40_000)).toBe(0);
  });
  it('release and expire clear the chip and the waiting; no ttl means no countdown', () => {
    for (const end of ['release', 'expire']) { const s = new ConflictStore(); s.apply(lock(1, 'acquire', 'a1')); s.apply(lock(2, 'deny', 'a2')); expect(s.getSnapshot().locks[0]!.expiresAt).toBeUndefined(); s.apply(lock(3, end, 'a1')); expect(s.getSnapshot().locks).toEqual([]); }
  });
  it('out-of-order delivery and duplicate seq give the same result as in order', () => {
    const evs = [lock(1, 'acquire', 'a1', { ttl: 5000 }), lock(2, 'deny', 'a2'), lock(3, 'release', 'a1'), lock(4, 'acquire', 'a2', { ttl: 5000 }), lock(5, 'deny', 'a3')];
    const run = (list: ConflictEvent[]) => { const s = new ConflictStore({ now: () => T0 }); list.forEach((e) => s.apply(e)); return s.getSnapshot().locks; }; const base = run(evs); expect(base).toMatchObject([{ agent: 'a2', waiting: ['a3'] }]);
    fc.assert(fc.property(fc.shuffledSubarray(evs, { minLength: 5, maxLength: 5 }), fc.array(fc.nat(4), { maxLength: 6 }), (shuf, dups) => { expect(run([...shuf, ...dups.map((i) => evs[i]!)])).toEqual(base); }), { numRuns: 60 });
  });
  it('a second acquire by someone else while held does not take the lock; a stale deny after the release is gone with it', () => {
    const s = new ConflictStore(); s.apply(lock(1, 'acquire', 'a1')); s.apply(lock(2, 'acquire', 'a2')); expect(s.getSnapshot().locks[0]!.agent).toBe('a1'); s.apply(lock(3, 'release', 'a1')); s.apply(lock(2.5, 'deny', 'a2')); expect(s.getSnapshot().locks).toEqual([]);
  });
  it('listeners hear every change, and the snapshot object is stable between changes', () => {
    const s = new ConflictStore(); let n = 0; const off = s.subscribe(() => n++); const a = s.getSnapshot(); expect(s.getSnapshot()).toBe(a); s.apply(lock(1, 'acquire', 'a1')); expect(n).toBe(1); expect(s.getSnapshot()).not.toBe(a); off(); s.apply(lock(2, 'release', 'a1')); expect(n).toBe(1);
  });
  it('garbage never throws and changes nothing', () => { const s = new ConflictStore(); for (const bad of [{ kind: 'file.lock', seq: 1, from: 'x', ts: 'no', p: {} }, { kind: 'file.lock', seq: 2, from: 'x', ts: iso(), p: { action: 'steal', path_hmac: H, agent_id: 'a' } }, { kind: 'conflict.detected', seq: 3, from: 'x', ts: iso(), p: { agent_ids: 7 } }, { kind: 'agent.state', seq: 4, from: 'x', ts: iso() }] as ConflictEvent[]) expect(() => s.apply(bad)).not.toThrow(); expect(s.getSnapshot()).toEqual({ locks: [], conflicts: [] }); });
});

describe('labels (acceptance 4)', () => {
  it('the label is the decrypted path, else file plus the first 4 characters of the hmac, never empty; it upgrades when the key arrives', () => {
    expect(fileLabel(H)).toBe('file ab12…'); expect(fileLabel('')).toBe('a file'); expect(fileLabel(H, '  ')).toBe('file ab12…'); expect(fileLabel(H, 'src/x.ts')).toBe('src/x.ts');
    const s = new ConflictStore(); s.apply(lock(1, 'acquire', 'a1')); expect(s.getSnapshot().locks[0]!.displayPath).toBeUndefined(); s.apply(lock(2, 'acquire', 'a1', { path: 'src/late.ts' })); expect(s.getSnapshot().locks[0]!.displayPath).toBe('src/late.ts');
  });
});

describe('conflicts (acceptance 3, 5)', () => {
  it('conflict.detected lists both agents; it lasts until every agent reports something newer that is not merge-conflict', () => {
    const s = new ConflictStore(); s.apply(conflict(10, ['a1', 'a2'], [H], ['src/m.ts'])); const [c] = s.getSnapshot().conflicts; expect(c).toMatchObject({ agents: ['a1', 'a2'], displayPaths: ['src/m.ts'] });
    s.apply(agentState(5, 'a1', 'idle')); s.apply(agentState(11, 'a1', 'merge-conflict')); s.apply(agentState(12, 'a2', 'thinking')); expect(s.getSnapshot().conflicts).toHaveLength(1); s.apply(agentState(13, 'a1', 'idle')); expect(s.getSnapshot().conflicts).toEqual([]);
  });
  it('markResolved removes it; an unknown agent id still keeps the banner; the file falls back to the hmac label', () => {
    const s = new ConflictStore(); s.apply(conflict(1, ['ghost'], [H])); expect(s.getSnapshot().conflicts[0]!.displayPaths).toEqual(['file ab12…']); s.markResolved(s.getSnapshot().conflicts[0]!.id); expect(s.getSnapshot().conflicts).toEqual([]);
  });
  it('card state: a conflict outranks tool work but never an approval, a question or a first-tier error; lock animations only when nothing urgent', () => {
    const s = new ConflictStore(); s.apply(lock(1, 'acquire', 'a1')); s.apply(lock(2, 'deny', 'a2')); s.apply(conflict(3, ['a2', 'a3'])); const snap = s.getSnapshot();
    expect(cardState('a2', 'tool-running', snap)).toEqual({ state: 'merge-conflict' }); expect(cardState('a2', 'awaiting-approval', snap)).toEqual({ state: 'awaiting-approval' }); expect(cardState('a2', 'asking-question', snap).state).toBe('asking-question'); expect(cardState('a2', 'error', snap).state).toBe('error');
    expect(cardState('a1', 'editing-file', snap)).toEqual({ state: 'editing-file', animation: 'file_locked' }); expect(cardState('a9', 'idle', snap)).toEqual({ state: 'idle' });
    const w = new ConflictStore(); w.apply(lock(1, 'acquire', 'a1')); w.apply(lock(2, 'deny', 'a2')); expect(cardState('a2', 'thinking', w.getSnapshot())).toEqual({ state: 'thinking', animation: 'waiting' }); expect(cardState('a2', 'awaiting-approval', w.getSnapshot()).animation).toBeUndefined();
  });
});
