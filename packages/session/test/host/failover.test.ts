import { describe, expect, it } from 'vitest';
import { adoptQueue } from '../../src/index.js';
import { mem } from '../rigs.js';
import { cleanup, ctl, que, setup, submit, wait } from './rig.js';

cleanup();
const state = (e: { queue(): { items: Record<string, unknown>[] } }, item: string) => (e.queue().items.find((i) => i.item === item) as { state: string } | undefined)?.state;

/** the host is a socket here so that it can drop; guests connect in the order g2, g1, so the lowest slot belongs to g2 (mem 3) */
async function room(policy: Record<string, unknown> = { auto_failover: true }, grace = 60) {
  const r = await setup({ policy, engine: { failoverGraceMs: grace } }); const host = await r.guest('host', 1); const g2 = await r.guest('g2', 3); const g1 = await r.guest('g1', 2); return { ...r, host, g1, g2 };
}

describe('host failover (C075)', () => {
  it('the lowest-slot connected editor becomes host; the old host\'s running item goes back to approved, as adoptQueue says', async () => {
    const { engine, host, g1, g2 } = await room(); const item = que('F1');
    await g1.t.send(submit(item)); await wait(() => engine.queue().items.length === 1); await host.t.send(ctl('queue.approve', { item })); await host.t.send(ctl('queue.claim', { item, agent_id: 'agt_AAAAAAAAAAAAAAAAAAAAAAAAA1' })); await wait(() => state(engine, item) === 'running');
    const before = engine.queue().items as { item: string; state: string }[]; const expected = adoptQueue(before).map((i) => ({ item: i.item, state: i.state }));
    await host.t.close(); await wait(() => g2.ofKind('control.host_changed').length === 1);
    expect(g2.ofKind('control.host_changed')[0]!.p).toEqual({ host: mem(3), code: 'failover' }); expect(g1.ofKind('control.host_changed')[0]!.p).toMatchObject({ host: mem(3), code: 'failover' });
    expect(engine.queue().items.map((i) => ({ item: (i as { item: string }).item, state: (i as { state: string }).state }))).toEqual(expected); expect(state(engine, item)).toBe('approved');
    const roster = engine.members(); expect(roster.find((m) => m.id === mem(3))!.role).toBe('host'); expect(roster.find((m) => m.id === mem(1))!.role).toBe('editor'); expect(roster.find((m) => m.id === mem(2))!.role).toBe('editor');
    await wait(() => (g1.ofKind('queue.state').at(-1)?.p as { items: { state: string }[] } | undefined)?.items[0]?.state === 'approved');
  });
  it('the new host can act at once; the old host, back as an editor, cannot', async () => {
    const { engine, host, g1, g2, guest } = await room(); const item = que('F2');
    await g1.t.send(submit(item)); await wait(() => engine.queue().items.length === 1); await host.t.close(); await wait(() => g2.ofKind('control.host_changed').length === 1);
    await g2.t.send(ctl('queue.approve', { item })); await wait(() => state(engine, item) === 'approved');
    const back = await guest('host', 1); await wait(() => back.ofKind('control.roster').length > 0); expect(engine.members().find((m) => m.id === mem(1))!.role).toBe('editor');
    await back.t.send(ctl('queue.claim', { item, agent_id: 'agt_AAAAAAAAAAAAAAAAAAAAAAAAA1' })); await new Promise((r) => setTimeout(r, 150)); expect(state(engine, item)).toBe('approved');
  });
  it('a host that comes back inside the grace time stays host and nothing moves', async () => {
    const { engine, host, g2, guest } = await room({ auto_failover: true }, 400); await host.t.close(); await wait(() => engine.members().find((m) => m.id === mem(1))!.connected === false); await guest('host', 1); await wait(() => engine.members().find((m) => m.id === mem(1))!.connected);
    await new Promise((r) => setTimeout(r, 600)); expect(g2.ofKind('control.host_changed')).toHaveLength(0); expect(engine.members().find((m) => m.id === mem(1))!.role).toBe('host');
  });
  it('without auto_failover the session waits: the host\'s items show as held and no one takes over', async () => {
    const { engine, host, g1, g2 } = await room({ auto_failover: false }); const item = que('F3');
    await g1.t.send(submit(item)); await wait(() => engine.queue().items.length === 1); await host.t.send(ctl('queue.approve', { item })); await wait(() => state(engine, item) === 'approved'); await host.t.close();
    await wait(() => (g2.ofKind('queue.state').at(-1)?.p as { items: { state: string }[] } | undefined)?.items[0]?.state === 'held'); await new Promise((r) => setTimeout(r, 200)); expect(g2.ofKind('control.host_changed')).toHaveLength(0);
  });
  it('with no editor connected the session pauses instead of handing the role to a viewer', async () => {
    const r = await setup({ policy: { auto_failover: true }, engine: { failoverGraceMs: 50 } }); const host = await r.guest('host', 1); const v = await r.guest('g3', 4); await host.t.close();
    await wait(() => v.ofKind('control.session_state').some((f) => (f.p as { state: string }).state === 'paused')); expect(v.ofKind('control.host_changed')).toHaveLength(0); expect(r.engine.members().find((m) => m.id === mem(4))!.role).toBe('viewer');
  });
  it('exactly one member is host afterwards', async () => {
    const { engine, host, g2 } = await room(); await host.t.close(); await wait(() => g2.ofKind('control.host_changed').length === 1); expect(engine.members().filter((m) => m.role === 'host')).toHaveLength(1);
  });
});
