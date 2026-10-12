import { describe, expect, it } from 'vitest';
import { initialGuestState, reduceGuestState, type GuestState, type DecodedFrame } from '@centcom/guest';
import { clean, runJoin, type JoinedLike } from '../src/commands/join.js';

const frame = (seq: number, k: string, from: string, secret: Record<string, unknown>, p: Record<string, unknown> = {}): DecodedFrame => ({ v: 1, t: 'event', id: `msg_${seq}`, sid: 'ses_1', from, ts: '2026-10-12T10:00:00.000Z', k, seq, p, secret } as never);
function fake(role: 'host' | 'editor' | 'viewer' = 'editor') {
  let st = initialGuestState({ member: 'mem_me', role }); st = { ...st, phase: 'live' }; const subs = new Set<(s: GuestState) => void>(); const asked: string[] = []; let left = false;
  const joined: JoinedLike = { state: () => st, subscribe: (f) => { subs.add(f); f(st); return () => subs.delete(f); }, people: () => [{ id: 'mem_host', name: 'Alice', role: 'host', you: false }, { id: 'mem_me', name: 'Bob', role: role, you: true }], role, ask: async (t) => { asked.push(t); }, leave: async () => { left = true; } };
  const push = (f: DecodedFrame) => { st = reduceGuestState(st, f); for (const s of [...subs]) s(st); };
  const end = () => { st = { ...st, phase: 'ended' }; for (const s of [...subs]) s(st); };
  return { joined, push, end, asked, left: () => left };
}
const io = () => { const out: string[] = []; const err: string[] = []; return { out, err, d: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } }; };

describe('centcom join', () => {
  it('says how to use it, and refuses odd options', async () => {
    const i = io(); const account = { join: async () => { throw new Error('not called'); } }; expect(await runJoin([], { account, ...i.d })).toBe(1); expect(i.err[0]).toMatch(/Usage: centcom join/); expect(await runJoin(['x', '--bogus'], { account, ...i.d })).toBe(1); expect(i.err.at(-1)).toMatch(/Unknown option --bogus/);
  });
  it('prints what the host\'s agent does as it happens, finished messages only, and leaves when the session ends', async () => {
    const f = fake(); const i = io(); const account = { join: async () => ({ joined: f.joined, how: 'invite' as const }) }; const run = runJoin(['https://centcom.dev/i/x'], { account, ...i.d });
    await new Promise((r) => setTimeout(r, 10)); f.push(frame(1, 'message.user', 'mem_host', { text: 'fix it' })); f.push(frame(2, 'message.assistant.delta', 'mem_host', { agent_id: 'a', message_id: 'm', index: 0, delta: 'Working on' }));
    expect(i.out.join('\n')).not.toContain('Working on'); f.push(frame(3, 'message.assistant.done', 'mem_host', { agent_id: 'a', message_id: 'm' })); f.push(frame(4, 'tool.request', 'mem_host', { agent_id: 'a', tool_id: 't', name: 'Edit', input_summary: 'a.ts', risk: 'low' })); f.end(); expect(await run).toBe(0);
    const text = i.out.join('\n'); expect(text).toContain('Joined (by invite) as can edit'); expect(text).toContain('Alice> fix it'); expect(text).toContain('Working on'); expect(text).toContain('› Edit: a.ts'); expect(text).toContain('The session has ended.'); expect(f.left()).toBe(true);
  });
  it('lines typed by an editor are asked of the host, a viewer\'s are not read, and a failure is explained', async () => {
    const f = fake(); const i = io(); async function* lines() { yield 'add tests'; yield '  '; yield 'and docs'; }
    const run = runJoin(['ses_x'], { account: { join: async () => ({ joined: f.joined, how: 'session' as const }) }, lines: lines(), ...i.d }); await new Promise((r) => setTimeout(r, 30)); f.end(); await run; expect(f.asked).toEqual(['add tests', 'and docs']);
    const v = fake('viewer'); const j = io(); async function* typed() { yield 'nope'; } const run2 = runJoin(['ses_x'], { account: { join: async () => ({ joined: v.joined, how: 'watch' as const }) }, lines: typed(), ...j.d }); await new Promise((r) => setTimeout(r, 30)); v.end(); await run2; expect(v.asked).toEqual([]); expect(j.out[0]).toMatch(/watch but not send/);
    const k = io(); expect(await runJoin(['x'], { account: { join: async () => { throw Object.assign(new Error('x'), { code: 'invite_expired' }); } }, ...k.d })).toBe(1); expect(k.err[0]).toMatch(/no longer valid/);
  });
  it('does not let the host write escape sequences or control characters into a guest terminal', () => {
    expect(clean('ok\u001b[2J\u001b[Hgone')).toBe('okgone'); expect(clean('a\u001b]0;pwned title\u0007b')).toBe('ab'); expect(clean('a\u001b]52;c;ZXZpbA==\u001b\\b')).toBe('ab');
    expect(clean('line one\nline two\ttab')).toBe('line one\nline two\ttab'); expect(clean('over\rwrite\u0007\u0008x')).toBe('overwritex'); expect(clean('\u001bPdevice control\u001b\\z')).toBe('z'); expect(clean('c1\u009b31mred')).toBe('c131mred');
  });
  it('prints host text through the filter', async () => {
    const f = fake('editor'); const i = io(); const run = runJoin(['ses_x'], { account: { join: async () => ({ joined: f.joined, how: 'session' as const }) }, ...i.d }); await new Promise((r) => setTimeout(r, 10));
    f.push(frame(1, 'message.user', 'mem_host', { text: 'hi\u001b]0;pwned\u0007 there\u001b[31m' })); await new Promise((r) => setTimeout(r, 10)); f.end(); await run;
    expect(i.out.join('\n')).toContain('> hi there'); expect(i.out.join('\n')).not.toMatch(/\u001b|pwned/);
  });
});
