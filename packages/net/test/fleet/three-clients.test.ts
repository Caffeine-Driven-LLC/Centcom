import { afterEach, describe, expect, it } from 'vitest';
import { FleetSync, type SessionHandle } from '../../src/index.js';
import { WS, rig, until, type Peer } from '../session/rig.js';

const real = { now: () => Date.now(), setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: never) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) };
const A1 = 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V4W'; const A2 = 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V5X'; const A3 = 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V6Y';
let r: Awaited<ReturnType<typeof rig>> | undefined; const syncs: FleetSync[] = []; const extra: Peer[] = [];
afterEach(async () => { for (const f of syncs.splice(0)) f.stop(); for (const p of [r?.host, r?.guest, ...extra.splice(0)]) await p?.handle?.leave().catch(() => undefined); await r?.stop(); r = undefined; });

describe('three members in branch mode (the G5 scenario)', () => {
  it('everyone sees everyone else\'s agents, branches and states; a lock clash ends in a conflict that two members hear about once', async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; const tp = await r.mk('Third', 'editor', 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V6Z').init(); extra.push(tp); const t = await tp.client.joinSession({ sessionId: h.id }); tp.handle = t;
    await until(() => [h, g, t].every((s: SessionHandle) => s.state === 'live') && h.roster().length === 3); const [hf, gf, tf] = [h, g, t].map((s) => { const f = new FleetSync(s, { clock: real }); f.start(); syncs.push(f); return f; }) as [FleetSync, FleetSync, FleetSync];
    await hf.spawn({ agentId: A1, mode: 'branch', label: 'host agent', branch: 'feat/h' }); await gf.spawn({ agentId: A2, mode: 'branch', label: 'guest agent', branch: 'feat/g' }); await tf.spawn({ agentId: A3, mode: 'branch', label: 'third agent' }); hf.setState(A1, 'editing-file'); gf.setState(A2, 'running-command'); await gf.updateBranch({ agentId: A2, branch: 'feat/g', head: 'abc1234', ahead: 3, behind: 1, dirty: true });
    await until(() => [hf, gf, tf].every((f) => f.fleet().members.length === 3 && f.fleet().members.flatMap((m) => m.agents).length === 3 && f.fleet().members.flatMap((m) => m.agents).some((a) => a.state === 'running-command') && f.fleet().members.flatMap((m) => m.agents).some((a) => a.branchStatus !== undefined)));
    const views = [hf, gf, tf].map((f) => JSON.stringify(f.fleet().members)); expect(new Set(views).size).toBe(1); const guestAgent = tf.fleet().members.flatMap((m) => m.agents).find((a) => a.agentId === A2)!; expect(guestAgent).toMatchObject({ label: 'guest agent', branch: 'feat/g', state: 'running-command', branchStatus: { ahead: 3, behind: 1, dirty: true } });
    const conflicts: unknown[] = []; hf.on('conflict', (c) => conflicts.push(c)); gf.on('conflict', (c) => conflicts.push(c)); expect(await hf.acquire(A1, 'src/shared.ts')).toBe('granted'); expect(await gf.acquire(A2, 'src/shared.ts')).toBe('denied'); await gf.reportConflict([A1, A2], ['src/shared.ts']);
    await until(() => conflicts.length === 2); expect(conflicts.every((c) => (c as { agentIds: string[] }).agentIds.includes(A1) || (c as { agentIds: string[] }).agentIds.includes(A2))).toBe(true); expect((conflicts[0] as { paths?: string[] }).paths).toEqual(['src/shared.ts']); await new Promise((x) => setTimeout(x, 300)); expect(conflicts).toHaveLength(2); expect(tf.fleet().conflicts).toHaveLength(1);
    const wire = JSON.stringify(r.m.relay.frames(h.id)); for (const s of ['feat/h', 'feat/g', 'src/shared.ts', 'host agent', 'abc1234']) expect(wire).not.toContain(s);
  });
});
