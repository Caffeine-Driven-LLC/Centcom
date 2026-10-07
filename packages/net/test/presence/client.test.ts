import { afterEach, describe, expect, it } from 'vitest';
import { KeyRing, PresenceClient, type ActivitySource, type SessionHandle } from '../../src/index.js';
import { WS, rig, until, virtualPeer } from '../session/rig.js';

const realClock = { now: () => Date.now(), setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: never) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) };
const act = (): ActivitySource => ({ lastInputAt: () => Date.now(), onInput: () => () => undefined });
let r: Awaited<ReturnType<typeof rig>> | undefined; const pcs: PresenceClient[] = [];
afterEach(async () => { for (const p of pcs.splice(0)) p.dispose(); await r?.host.handle?.leave().catch(() => undefined); await r?.guest.handle?.leave().catch(() => undefined); await r?.stop(); r = undefined; });
const start = async () => { r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; await until(() => g.state === 'live' && h.roster().length === 2); const hp = new PresenceClient(h, { clock: realClock, activity: act() }); const gp = new PresenceClient(g, { clock: realClock, activity: act() }); pcs.push(hp, gp); return { h, g, hp, gp }; };
const flush = async () => { await new Promise((x) => setTimeout(x, 150)); await r!.m.control('advance', { ms: 700 }); await new Promise((x) => setTimeout(x, 150)); };

describe('two clients through the relay', () => {
  it('typing and status reach the other member; a cursor round-trips through ct and the relay log shows no path', { timeout: 20_000 }, async () => {
    const { h, g, hp, gp } = await start(); const gid = g.me.id; gp.setActivity('typing'); await flush(); await until(() => hp.members().get(gid)?.activity === 'typing'); await new Promise((x) => setTimeout(x, 1050)); gp.setStatus('busy'); await flush(); await until(() => hp.members().get(gid)?.status === 'busy'); expect(hp.members().get(gid)).toMatchObject({ status: 'busy', activity: 'typing' });
    gp.setCursor({ path: 'src/CANARY-7f3a.ts', line: 12, col: 3, selEndLine: 14, selEndCol: 1 }); await flush(); await until(() => hp.members().get(gid)?.cursor !== undefined); expect(hp.members().get(gid)!.cursor).toEqual({ path: 'src/CANARY-7f3a.ts', line: 12, col: 3, selEndLine: 14, selEndCol: 1 }); expect(JSON.stringify(r!.m.relay.frames(h.id))).not.toContain('CANARY-7f3a'); expect(h.presenceDropped()).toBe(0);
  });
  it('a cursor that fails verification is dropped silently and counted; a frame from outside the roster is ignored', async () => {
    const { h, hp } = await start(); const vp = await virtualPeer(r!, h.id, 'Mallory', KeyRing.create(), 'editor'); await new Promise((x) => setTimeout(x, 150)); const f = vp.encode('presence.cursor', { secret: { line: 1 } }); vp.raw({ ...f, sig: 'AAAA' }); await flush(); await until(() => h.presenceDropped() >= 1);
    expect(hp.members().get(vp.memberId)?.cursor).toBeUndefined(); const ghost = await virtualPeer(r!, h.id, 'Ghost', KeyRing.create(), 'editor', false); ghost.raw({ t: 'presence', k: 'presence.update', p: { status: 'busy', activity: 'running' } }); await flush(); expect(hp.members().get(ghost.memberId)).toBeUndefined();
  });
  it('presence is ephemeral: nothing is buffered or resent across a reconnect, and everything else keeps working', async () => {
    const { h, g, hp, gp } = await start(); const count = () => r!.m.relay.frames(h.id).filter((f) => f.t === 'presence').length; gp.setActivity('reviewing'); await flush(); await until(() => count() >= 1); await r!.m.control('disconnect', { sid: h.id, code: 1001 }); gp.setActivity('running'); gp.setCursor({ line: 4 }); await new Promise((x) => setTimeout(x, 100));
    const during = count(); await until(() => g.state === 'live' && h.state === 'live', 6000); await new Promise((x) => setTimeout(x, 700)); await flush(); expect(count()).toBeLessThanOrEqual(during + 2); const got: string[] = []; h.on('message.user', (e) => got.push(String(e.secret?.text))); await g.sendEvent('message.user', { secret: { text: 'still works' } }); await until(() => got.includes('still works')); void hp;
  });
  it('setActivity, setCursor and setStatus return at once and never throw, even when the session has ended', async () => {
    const { g, gp } = await start(); await g.leave(); expect(() => { gp.setActivity('typing'); gp.setCursor({ line: 1 }); gp.setStatus('busy'); }).not.toThrow(); await new Promise((x) => setTimeout(x, 50));
  });
});
