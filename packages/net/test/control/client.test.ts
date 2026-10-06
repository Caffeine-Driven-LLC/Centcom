import { afterEach, describe, expect, it } from 'vitest';
import { ControlClient, ControlNotHostError, ForbiddenError, InvalidPolicyError, KeyRing, SelfActionError, SessionError, type SessionHandle } from '../../src/index.js';
import { ManualClock, WS, rig, until, virtualPeer, type Peer } from '../session/rig.js';

let r: Awaited<ReturnType<typeof rig>> | undefined; const ctls: ControlClient[] = []; const extra: Peer[] = [];
afterEach(async () => { for (const c of ctls.splice(0)) c.dispose(); for (const p of [r?.host, r?.guest, ...extra.splice(0)]) await p?.handle?.leave().catch(() => undefined); await r?.stop(); r = undefined; });
const start = async (o: { guestClock?: ManualClock } = {}) => { r = await rig(); if (o.guestClock) await r.guest.init({ clock: o.guestClock }); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; await until(() => g.state === 'live' && h.roster().length === 2); const hc = new ControlClient(h); const gc = new ControlClient(g, o.guestClock ? { clock: o.guestClock } : {}); ctls.push(hc, gc); return { h, g, hc, gc, gid: h.roster().find((m) => m.device === r!.guest.deviceId)!.id }; };
const frames = (sid: string) => r!.m.relay.frames(sid);

describe('host actions (acceptance 1, 2)', () => {
  it('kick sends one clear control frame; member_left and rotate_key follow with consecutive seq and the client reports them in that order', async () => {
    const { h, hc, gid } = await start(); const order: string[] = []; hc.on('member-left', (e) => order.push(`left:${e.member === gid}:${e.code}`)); hc.on('rotate-key', (e) => order.push(`rotate:${e.reason}`)); const before = frames(h.id).length;
    const { seq } = await hc.kick(gid, 'abuse'); expect(seq).toBeGreaterThan(0); await until(() => order.length === 2); expect(order).toEqual(['left:true:kicked', 'rotate:member_removed']); const f = frames(h.id).slice(before); expect(f.map((x) => x.k)).toEqual(['control.kick', 'control.member_left', 'control.rotate_key']); expect(f[2]!.seq).toBe(f[1]!.seq! + 1); expect(f[0]!.t).toBe('control'); expect(f[0]!.id).toMatch(/^msg_/);
  });
  it('a guest gets NotHostError with nothing sent; the host cannot act on itself; requestRotation is for the host', async () => {
    const { h, hc, gc, gid } = await start(); const before = frames(h.id).length; for (const f of [() => gc.kick(gid, 'other'), () => gc.mute(gid), () => gc.unmute(gid), () => gc.setRole(gid, 'viewer'), () => gc.transferHost(gid), () => gc.endSession('done'), () => gc.setPolicy({ auto_approve: 'ask', share_history: true, queue_limit: 5 })]) await expect(f()).rejects.toBeInstanceOf(ControlNotHostError); expect(frames(h.id).length).toBe(before);
    for (const f of [() => hc.kick(h.me.id, 'other'), () => hc.mute(h.me.id), () => hc.setRole(h.me.id, 'viewer'), () => hc.transferHost(h.me.id)]) await expect(f()).rejects.toBeInstanceOf(SelfActionError); await expect(gc.requestRotation('requested')).rejects.toBeInstanceOf(ForbiddenError); expect(frames(h.id).length).toBe(before);
    await hc.requestRotation('scheduled'); await until(() => frames(h.id).some((x) => x.k === 'control.rotate_request')); expect(frames(h.id).filter((x) => x.k === 'control.rotate_request')).toHaveLength(1);
  });
  it('setPolicy checks the contract first, then the next policy event shows the merged state', async () => {
    const { g, hc, gc } = await start(); await expect(hc.setPolicy({ auto_approve: 'ask', share_history: true, queue_limit: -1 })).rejects.toBeInstanceOf(InvalidPolicyError); await expect(hc.setPolicy({ auto_approve: 'chaos' as never, share_history: true, queue_limit: 5 })).rejects.toBeInstanceOf(InvalidPolicyError); expect(frames(g.id).some((x) => x.k === 'control.policy')).toBe(false);
    const seen: unknown[] = []; gc.on('policy', (p) => seen.push(p)); await hc.setPolicy({ auto_approve: 'trusted', share_history: false, queue_limit: 10, locked: true }); await until(() => seen.length === 1); expect(seen[0]).toMatchObject({ auto_approve: 'trusted', share_history: false, queue_limit: 10, locked: true }); expect(gc.state().policy.locked).toBe(true); expect(g.policy.locked).toBe(true);
  });
  it('a denied action surfaces ForbiddenError and changes nothing', async () => {
    const { g, h } = await start(); const gid = h.me.id; const lying = new Proxy(g, { get: (t, k) => (k === 'me' ? { ...t.me, role: 'host' } : (t as never)[k as never]) }) as SessionHandle; const liar = new ControlClient(lying); ctls.push(liar); await expect(liar.kick(gid, 'other')).rejects.toBeInstanceOf(ForbiddenError); expect(g.state).toBe('live'); expect(liar.state().sessionState).toBe('live');
  });
});
describe('roles, mute and host change', () => {
  it('setRole changes the member; a viewer is shown as one; mute for self is reported and ends at its time on the injected clock', async () => {
    const clock = new ManualClock(); const { h, g, hc, gc, gid } = await start({ guestClock: clock }); const events: string[] = []; gc.on('muted', (e) => events.push(`muted:${e.until ?? '-'}`)); gc.on('unmuted', () => events.push('unmuted'));
    await hc.setRole(gid, 'viewer'); await until(() => g.me.role === 'viewer' && gc.state().me.role === 'viewer'); expect(h.roster().find((m) => m.id === gid)!.role).toBe('viewer'); await hc.setRole(gid, 'editor'); await until(() => g.me.role === 'editor');
    const until1 = new Date(clock.now() + 60_000); await hc.mute(gid, until1); await until(() => gc.state().me.muted); expect(gc.state().me).toMatchObject({ muted: true, mutedUntil: until1.toISOString() }); expect(events).toEqual([`muted:${until1.toISOString()}`]);
    await expect(g.sendEvent('message.user', { secret: { text: 'x' } })).rejects.toMatchObject({ code: 'muted' }); await expect(g.sendEvent('queue.cancel', { p: { item: 'que_01JA3Z8K2M5N7P9Q0R1S2T3V4W' } })).rejects.toBeInstanceOf(SessionError); await g.sendEvent('presence.update', { p: { status: 'online', activity: 'idle' } });
    await clock.advance(61_000); expect(gc.state().me.muted).toBe(false); expect(events.at(-1)).toBe('unmuted'); expect(g.muted().muted).toBe(false); await hc.unmute(gid); /* the mock relay keeps its own mute flag; a real one ends it at `until` */ await new Promise((x) => setTimeout(x, 200)); await g.sendEvent('message.user', { secret: { text: 'back' } });
  });
  it('transfer_host makes the guest the host exactly once and the old host an editor', async () => {
    const { h, g, hc, gc, gid } = await start(); const lost: string[] = []; const became: string[] = []; hc.on('lost-host', () => lost.push('lost')); gc.on('became-host', () => became.push('became')); await hc.transferHost(gid); await until(() => g.me.role === 'host' && h.me.role === 'editor'); expect(became).toEqual(['became']); expect(lost).toEqual(['lost']); expect(gc.state().host).toBe(gid); expect(hc.state().me.role).toBe('editor'); await new Promise((x) => setTimeout(x, 200)); expect(became).toHaveLength(1);
  });
});
describe('forged and stale frames (acceptance 3)', () => {
  it('a roster frame from a normal member is ignored and counted', async () => {
    const { h, hc } = await start(); const vp = await virtualPeer(r!, h.id, 'Mallory', KeyRing.create(), 'editor'); await new Promise((x) => setTimeout(x, 150)); const before = JSON.stringify(h.roster().map((m) => m.id)); vp.raw({ t: 'control', k: 'control.roster', id: vp.nextId(), p: { version: 99, members: [] } }); await until(() => hc.warnings >= 1); expect(JSON.stringify(h.roster().map((m) => m.id))).toBe(before);
  });
});
describe('being removed (acceptance 7)', () => {
  it('after being kicked the client stops, forgets the keys of the session, does not reconnect and says so once', async () => {
    const { h, g, hc, gc, gid } = await start(); const removed: unknown[] = []; gc.on('removed-from-session', (e) => removed.push(e)); const lifecycle: unknown[] = []; g.on('removed', (e) => lifecycle.push(e)); expect(g.heldEpochs().length).toBeGreaterThan(0); const tokens = () => r!.guest.seen.filter((s) => s.path.endsWith('/join-token')).length; const n = tokens();
    await hc.kick(gid, 'abuse'); await until(() => removed.length === 1); await new Promise((x) => setTimeout(x, 600)); expect(removed).toEqual([{ code: 'kicked' }]); expect(lifecycle).toHaveLength(1); expect(g.heldEpochs()).toEqual([]); expect(g.state).toBe('ended'); expect(tokens()).toBe(n); await expect(g.sendEvent('message.user', { secret: { text: 'x' } })).rejects.toBeInstanceOf(SessionError); void h;
  });
});
