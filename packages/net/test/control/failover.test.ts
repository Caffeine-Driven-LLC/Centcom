import { afterEach, describe, expect, it } from 'vitest';
import { ControlClient } from '../../src/index.js';
import { WS, rig, until } from '../session/rig.js';

let r: Awaited<ReturnType<typeof rig>> | undefined; const ctls: ControlClient[] = [];
afterEach(async () => { for (const c of ctls.splice(0)) c.dispose(); for (const p of [r?.host, r?.guest]) await p?.handle?.leave().catch(() => undefined); await r?.stop(); r = undefined; });
const start = async () => { r = await rig({ relay: { hostGraceMs: 30_000 } }); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; await until(() => g.state === 'live' && h.roster().length === 2); const hc = new ControlClient(h); const gc = new ControlClient(g); ctls.push(hc, gc); return { h, g, hc, gc }; };

describe('host failover on the real session path (C060)', () => {
  it('with auto_failover on, the host dropping makes the guest host through the relay: one became-host, then it can act as host', async () => {
    const { h, g, hc, gc } = await start(); await hc.setPolicy({ auto_approve: 'ask', share_history: true, queue_limit: 10, auto_failover: true } as never); await until(() => gc.state().policy.auto_failover === true);
    const became: string[] = []; const codes: string[] = []; gc.on('became-host', () => became.push('became')); gc.on('host-changed', (e) => codes.push(e.code));
    await h.leave(); await r!.m.advance(31_000);
    await until(() => became.length === 1 && g.me.role === 'host'); expect(codes).toEqual(['failover']); expect(gc.state().host).toBe(g.me.id); expect(gc.state().me.role).toBe('host');
    await expect(gc.setPolicy({ auto_approve: 'ask', share_history: true, queue_limit: 5 })).resolves.toMatchObject({ seq: expect.any(Number) });
  });
  it('without auto_failover the session pauses and nobody is promoted', async () => {
    const { h, g, gc } = await start(); const became: string[] = []; gc.on('became-host', () => became.push('b'));
    await h.leave(); await r!.m.advance(31_000); await until(() => gc.state().sessionState === 'paused'); expect(became).toEqual([]); expect(g.me.role).toBe('editor');
  });
});
