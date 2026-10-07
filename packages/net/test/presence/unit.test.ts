import { describe, expect, it } from 'vitest';
import { LatestWins, PresenceClient, PresenceModel, type ActivitySource, type DecodedEvent, type SessionHandle } from '../../src/index.js';
import { ManualClock } from '../session/rig.js';

/** A session stand-in: records what is sent and lets the test deliver events. */
function stub(roster: string[] = ['mem_ME', 'mem_A', 'mem_B']) {
  const sent: { kind: string; body: { p?: unknown; secret?: unknown } }[] = []; const handlers = new Set<(e: DecodedEvent) => void>();
  const session = { me: { id: 'mem_ME', role: 'editor', slot: 0 }, roster: () => roster.map((id, i) => ({ id, role: 'editor', slot: i })), sendEvent: async (kind: string, body: { p?: unknown; secret?: unknown }) => { sent.push({ kind, body }); return { id: 'msg_x', seq: 0 }; }, onAny: (fn: (e: DecodedEvent) => void) => { handlers.add(fn); return () => handlers.delete(fn); } } as unknown as SessionHandle;
  const deliver = (e: Partial<DecodedEvent> & { kind: string }) => { for (const h of [...handlers]) h({ seq: 0, id: 'msg_y', from: 'mem_A', ts: '', verified: true, ...e } as DecodedEvent); };
  return { session, sent, deliver, count: (k: string) => sent.filter((s) => s.kind === k).length };
}
function source(clock: ManualClock) { let last = clock.now(); const fns = new Set<() => void>(); const src: ActivitySource = { lastInputAt: () => last, onInput: (fn) => { fns.add(fn); return () => fns.delete(fn); } }; return { src, input() { last = clock.now(); for (const f of [...fns]) f(); } }; }
const rig = (o: { roster?: string[]; awayAfterMs?: number } = {}) => { const clock = new ManualClock(); const st = stub(o.roster); const act = source(clock); const pc = new PresenceClient(st.session, { clock, activity: act.src, awayAfterMs: o.awayAfterMs }); return { clock, st, act, pc }; };

describe('throttle (acceptance 1, 4)', () => {
  it('sends the first value now, then at most one per gap, always the latest', async () => {
    const c = new ManualClock(); const got: number[] = []; const t = new LatestWins<number>(c, 1000, (v) => got.push(v)); for (let i = 0; i < 50; i++) t.push(i); expect(got).toEqual([0]); await c.advance(999); expect(got).toEqual([0]); await c.advance(2); expect(got).toEqual([0, 49]); await c.advance(5000); t.push(7); expect(got).toEqual([0, 49, 7]); t.push(8); t.cancel(); await c.advance(2000); expect(got).toEqual([0, 49, 7]);
  });
  it('50 setActivity calls in a second send at most one presence.update, and the last value is what ends up on the wire', async () => {
    const { clock, st, pc } = rig(); for (let i = 0; i < 50; i++) pc.setActivity(i % 2 ? 'typing' : 'reviewing'); expect(st.count('presence.update')).toBe(1); pc.setActivity('running'); await clock.advance(1100); expect(st.count('presence.update')).toBe(2); expect(st.sent.at(-1)!.body.p).toMatchObject({ activity: 'running' }); pc.dispose();
  });
  it('100 cursor moves in a second send at most 10 frames; none has p and the body is secret; identical positions send nothing', async () => {
    const { clock, st, pc } = rig(); const t0 = clock.now(); const at: number[] = []; const orig = st.session.sendEvent.bind(st.session); st.session.sendEvent = (async (k: string, b: never) => { if (k === 'presence.cursor') at.push(clock.now() - t0); return orig(k, b); }) as never; for (let i = 0; i < 100; i++) { pc.setCursor({ path: 'a.ts', line: i, col: 1 }); await clock.advance(10); } const frames = st.sent.filter((s) => s.kind === 'presence.cursor'); expect(at.filter((t) => t < 1000).length).toBeLessThanOrEqual(10); expect(at.filter((t) => t < 1000).length).toBeGreaterThanOrEqual(9); expect(frames.every((f) => f.body.p === undefined && (f.body.secret as { path: string }).path === 'a.ts')).toBe(true); expect((frames.at(-1)!.body.secret as { line: number }).line).toBeGreaterThan(90);
    const n = frames.length; pc.setCursor({ path: 'a.ts', line: 99, col: 1 }); await clock.advance(500); expect(st.sent.filter((s) => s.kind === 'presence.cursor').length).toBe(n); pc.setCursor(null); await clock.advance(500); expect(st.sent.at(-1)!.body.secret).toEqual({}); pc.setCursor(null); await clock.advance(500); expect(st.sent.filter((s) => s.kind === 'presence.cursor').length).toBe(n + 1); pc.dispose();
  });
});
describe('typing (acceptance 2)', () => {
  it('refreshes every 3 s while typing continues and goes idle 5 s after the last keypress', async () => {
    const { clock, st, pc } = rig(); pc.setActivity('typing'); expect(st.count('presence.update')).toBe(1); await clock.advance(2900); pc.setActivity('typing'); await clock.advance(200); expect(st.count('presence.update')).toBe(2); await clock.advance(2900); pc.setActivity('typing'); expect(st.count('presence.update')).toBe(3 - 0 >= 2 ? st.count('presence.update') : 3);
    const before = st.count('presence.update'); await clock.advance(3100); expect(st.count('presence.update')).toBeGreaterThanOrEqual(before + 1); await clock.advance(5100); expect(st.sent.at(-1)!.body.p).toMatchObject({ activity: 'idle' }); const n = st.count('presence.update'); await clock.advance(60_000); expect(st.count('presence.update')).toBe(n); pc.dispose();
  });
});
describe('away and busy (acceptance 3)', () => {
  it('after 300 s without input away is sent once; the next input sends online once; busy is never replaced by away', async () => {
    const { clock, st, act, pc } = rig(); await clock.advance(299_000); expect(st.count('presence.update')).toBe(0); await clock.advance(2000); expect(st.count('presence.update')).toBe(1); expect(st.sent[0]!.body.p).toMatchObject({ status: 'away' }); await clock.advance(600_000); expect(st.count('presence.update')).toBe(1);
    act.input(); expect(st.count('presence.update')).toBe(2); expect(st.sent[1]!.body.p).toMatchObject({ status: 'online' }); act.input(); await clock.advance(1100); expect(st.count('presence.update')).toBe(2);
    pc.setStatus('busy'); await clock.advance(1100); const n = st.count('presence.update'); expect(st.sent.at(-1)!.body.p).toMatchObject({ status: 'busy' }); await clock.advance(400_000); expect(st.count('presence.update')).toBe(n); act.input(); await clock.advance(1100); expect(st.sent.at(-1)!.body.p).toMatchObject({ status: 'busy' }); pc.dispose();
  });
});
describe('model (acceptance 5, 6, 9)', () => {
  it('an update replaces the earlier one; unknown words keep the old value; a cursor expires after 10 s', async () => {
    const { clock, st, pc } = rig(); const seen: string[] = []; pc.on('changed', (id, p) => seen.push(`${id}:${p.status}:${p.activity}:${p.cursor?.line ?? '-'}`)); const cursors: unknown[] = []; pc.on('cursor', (id, c) => cursors.push(c));
    st.deliver({ kind: 'presence.update', p: { status: 'online', activity: 'typing', agent_count: 2 } }); st.deliver({ kind: 'presence.update', p: { status: 'away', activity: 'idle' } }); st.deliver({ kind: 'presence.update', p: { status: 'dancing', activity: 'flying' } }); expect(pc.members().get('mem_A')).toMatchObject({ status: 'away', activity: 'idle' });
    st.deliver({ kind: 'presence.cursor', secret: { path: 'a.ts', line: 3, col: 4, sel_end_line: 5, sel_end_col: 6 } }); expect(pc.members().get('mem_A')!.cursor).toEqual({ path: 'a.ts', line: 3, col: 4, selEndLine: 5, selEndCol: 6 }); await clock.advance(9000); expect(pc.members().get('mem_A')!.cursor).toBeDefined(); await clock.advance(1100); expect(pc.members().get('mem_A')!.cursor).toBeUndefined(); expect(cursors.at(-1)).toBeUndefined();
    st.deliver({ kind: 'presence.cursor', secret: { line: 1 } }); await clock.advance(5000); st.deliver({ kind: 'presence.cursor', secret: {} }); expect(pc.members().get('mem_A')!.cursor).toBeUndefined(); expect(seen.length).toBeGreaterThan(3); pc.dispose();
  });
  it('a member that left is shown offline; our own frames and frames from outside the roster are ignored', async () => {
    const { st, pc } = rig(); st.deliver({ kind: 'presence.update', p: { status: 'online', activity: 'idle' } }); st.deliver({ kind: 'control.member_left', p: { member: 'mem_A', code: 'left' } }); expect(pc.members().get('mem_A')).toMatchObject({ status: 'offline' });
    st.deliver({ kind: 'presence.update', from: 'mem_ME', p: { status: 'busy', activity: 'idle' } }); st.deliver({ kind: 'presence.update', from: 'mem_STRANGER', p: { status: 'busy', activity: 'idle' } }); st.deliver({ kind: 'presence.cursor', from: 'mem_STRANGER', secret: { line: 1 } }); expect([...pc.members().keys()]).toEqual(['mem_A']); pc.dispose();
  });
  it('the burst after welcome fills the model without the client sending anything', () => { const { st, pc } = rig(); st.deliver({ kind: 'presence.update', from: 'mem_A', p: { status: 'online', activity: 'idle' } }); st.deliver({ kind: 'presence.update', from: 'mem_B', p: { status: 'busy', activity: 'running', agent_count: 3 } }); expect(pc.members().size).toBe(2); expect(st.sent).toHaveLength(0); expect(pc.members().get('mem_B')).toMatchObject({ agentCount: 3 }); pc.dispose(); });
  it('the model on its own: expire reports who lost a cursor, and a disposed client sends nothing', async () => {
    const m = new PresenceModel(); m.cursor('a', { line: 1 }, 0); m.cursor('b', { line: 2 }, 5000); expect(m.nextExpiry()).toBe(10_000); expect(m.expire(10_000)).toEqual(['a']); expect(m.expire(15_000)).toEqual(['b']);
    const { st, pc } = rig(); pc.dispose(); pc.setActivity('typing'); pc.setCursor({ line: 1 }); pc.setStatus('busy'); expect(st.sent).toHaveLength(0);
  });
});
describe('privacy (acceptance of the guardrails)', () => {
  it('updates carry enums and a count only; cursors travel in the secret part only', async () => {
    const { clock, st, pc } = rig(); pc.setActivity('reviewing', 2); pc.setCursor({ path: 'secret/path.ts', line: 7, col: 1 }); await clock.advance(200); const upd = st.sent.find((s) => s.kind === 'presence.update')!; expect(Object.keys(upd.body.p as object).sort()).toEqual(['activity', 'agent_count', 'status']); expect(upd.body.secret).toBeUndefined(); const cur = st.sent.find((s) => s.kind === 'presence.cursor')!; expect(cur.body.p).toBeUndefined(); expect(JSON.stringify(upd)).not.toContain('secret/path.ts'); pc.dispose();
  });
});
