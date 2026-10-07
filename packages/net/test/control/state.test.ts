import { describe, expect, it } from 'vitest';
import { ControlStateModel, readServerFrame, type DecodedEvent } from '../../src/index.js';

const T0 = Date.UTC(2026, 10, 7, 12); let now = T0;
const model = (role: 'host' | 'editor' = 'editor') => { now = T0; return new ControlStateModel({ meId: 'mem_ME', role, host: role === 'host' ? 'mem_ME' : 'mem_H' }, () => now); };
const ev = (kind: string, p: Record<string, unknown>, from = 'srv', seq = 1): DecodedEvent => ({ kind, p, from, seq, id: 'msg_x', ts: '', verified: true });

describe('mute (acceptance 4)', () => {
  it('a mute with an end time ends by itself; without one it lasts until unmute', () => {
    const m = model(); const until = new Date(T0 + 60_000).toISOString(); expect(m.apply('control.mute', { member: 'mem_ME', until }, 5)).toEqual([{ kind: 'muted' }]); expect(m.get().me).toMatchObject({ muted: true, mutedUntil: until }); now = T0 + 59_999; expect(m.get().me.muted).toBe(true); now = T0 + 60_000; expect(m.get().me.muted).toBe(false); expect(m.get().me.mutedUntil).toBeUndefined();
    m.apply('control.mute', { member: 'mem_ME' }, 6); now = T0 + 99_000_000; expect(m.get().me.muted).toBe(true); expect(m.apply('control.unmute', { member: 'mem_ME' }, 7)).toEqual([{ kind: 'unmuted' }]); expect(m.get().me.muted).toBe(false); expect(m.nextMuteEnd()).toBeUndefined();
  });
  it('a mute for someone else changes nothing', () => { const m = model(); expect(m.apply('control.mute', { member: 'mem_OTHER' }, 2)).toEqual([]); expect(m.get().me.muted).toBe(false); expect(m.apply('control.unmute', { member: 'mem_OTHER' }, 3)).toEqual([]); });
});
describe('host and role (acceptance 5, 6)', () => {
  it('becoming host happens once; losing it demotes to editor; the same frame twice does not repeat', () => {
    const a = model(); expect(a.apply('control.host_changed', { host: 'mem_ME', code: 'transfer' }, 3)).toEqual([{ kind: 'became-host' }]); expect(a.get()).toMatchObject({ host: 'mem_ME', me: { role: 'host' } }); expect(a.apply('control.host_changed', { host: 'mem_ME', code: 'transfer' }, 4)).toEqual([]);
    const b = model('host'); expect(b.apply('control.host_changed', { host: 'mem_NEW', code: 'transfer' }, 3)).toEqual([{ kind: 'lost-host' }]); expect(b.get()).toMatchObject({ host: 'mem_NEW', me: { role: 'editor' } });
  });
  it('failover: host_changed then paused then live in seq order, and one became-host', () => {
    const m = model(); const all = [m.apply('control.host_changed', { host: 'mem_ME', code: 'failover' }, 10), m.apply('control.session_state', { state: 'paused' }, 11), m.apply('control.session_state', { state: 'live' }, 12), m.apply('control.host_changed', { host: 'mem_ME', code: 'failover' }, 13)].flat(); expect(all.filter((c) => c.kind === 'became-host')).toHaveLength(1); expect(m.get()).toMatchObject({ sessionState: 'live', effectiveFromSeq: 13 });
  });
  it('a role change for us applies unless we are the host; unknown roles and states are ignored', () => { const m = model(); expect(m.apply('control.role', { member: 'mem_ME', role: 'viewer' }, 2)).toEqual([{ kind: 'role' }]); expect(m.get().me.role).toBe('viewer'); expect(m.apply('control.role', { member: 'mem_ME', role: 'wizard' }, 3)).toEqual([]); expect(m.apply('control.session_state', { state: 'exploding' }, 4)).toEqual([]); const h = model('host'); h.apply('control.role', { member: 'mem_ME', role: 'viewer' }, 2); expect(h.get().me.role).toBe('host'); });
});
describe('policy and effective-from-seq', () => {
  it('a policy frame merges into what was there, and the position moves forward only', () => { const m = model(); m.apply('control.policy', { auto_approve: 'ask', share_history: true, queue_limit: 20 }, 4); m.apply('control.policy', { locked: true, queue_limit: 10 }, 9); expect(m.get().policy).toEqual({ auto_approve: 'ask', share_history: true, queue_limit: 10, locked: true }); m.apply('control.session_state', { state: 'live' }, 7); expect(m.get().effectiveFromSeq).toBe(9); });
});
describe('server frames (acceptance 3)', () => {
  it('only the server may send them; a roster that is not newer is ignored', () => {
    for (const k of ['control.member_joined', 'control.member_left', 'control.roster', 'control.host_changed', 'control.session_state', 'control.rotate_key']) { expect(readServerFrame(ev(k, { version: 5 }, 'mem_X'), { lastRosterVersion: 0 })).toEqual({ event: null, warn: 'forged_server_frame' }); expect(readServerFrame(ev(k, { version: 5, member: 'mem_A', host: 'mem_A', state: 'live', kid: 'k2' }), { lastRosterVersion: 0 }).event).not.toBeNull(); }
    expect(readServerFrame(ev('control.roster', { version: 3, members: [] }), { lastRosterVersion: 3 })).toEqual({ event: null, warn: 'stale_roster' }); expect(readServerFrame(ev('control.roster', { version: 4, members: [{}] }), { lastRosterVersion: 3 }).event).toMatchObject({ type: 'roster', version: 4 });
    expect(readServerFrame(ev('control.kick', { member: 'mem_A' }, 'mem_H'), { lastRosterVersion: 0 })).toEqual({ event: null }); expect(readServerFrame(ev('control.member_left', { member: 'mem_A' }), { lastRosterVersion: 0 }).event).toMatchObject({ type: 'member-left', code: 'left' });
  });
});
