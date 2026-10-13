import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionHandle } from '@centcom/net';
import { createAgentBus, createLockClient, createLockHub, nodeLockFs, type LockHub } from '@centcom/agent';
import { FakeEngine } from '@centcom/testkit';
import { AppController } from '../../src/controller.js';
import { HostBridge } from '../../src/collab/host-bridge.js';
import { WS, rig, until } from '../../../net/test/session/rig.js';

let cleanup: (() => Promise<void> | void)[] = []; afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });
const clock = { now: () => Date.now(), setTimeout: (f: () => void, ms: number) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, clearTimeout: (h: never) => clearTimeout(h as NodeJS.Timeout) };

/** One person's side: their own controller (their own agent), a lock client and a branch bridge on their end of the session. */
async function person(handle: SessionHandle, branch: string, o: { shareActivity?: boolean } = {}) {
  const ctl = new AppController({ engine: new FakeEngine({ script: {} }) as never, demo: false, cwd: '/tmp', version: 't', skills: [] }); await ctl.start(); cleanup.push(() => ctl.stop());
  const hub: LockHub = createLockHub(); const conflicts: { agents: string[]; hmacs: string[] }[] = []; const errors: string[] = [];
  const locks = createLockClient({ root: mkdtempSync(join(tmpdir(), 'cc-locks-')), fs: nodeLockFs, clock, bus: createAgentBus({ onError: () => undefined }), config: { mode: 'warn', defaultTtlMs: 60_000 }, transport: hub.transport, pathMac: (p) => hub.pathMac(p) ?? '', wireId: hub.wireId, onConflictDetected: hub.onConflict }); hub.client = locks; cleanup.push(() => locks.dispose());
  const bridge = new HostBridge(ctl, handle, { mode: 'branch', flushMs: 5, locks: hub, shareActivity: o.shareActivity, branchProbe: async () => ({ branch, head: 'abc1234', ahead: 1, behind: 0, dirty: true }), onConflict: (c) => conflicts.push(c), onError: (e) => errors.push(String(e)) }); bridge.start(); cleanup.push(() => bridge.stop());
  const agent = ctl.state.agents.find((a) => a.mine)!.id;
  return { ctl, bridge, locks, hub, conflicts, errors, agent };
}
async function setup() {
  const r = await rig(); cleanup.push(() => r.stop());
  const host = await r.host.client.createSession({ name: 'branches', workspace: WS }); r.host.handle = host; cleanup.push(() => host.leave().catch(() => undefined));
  const guest = await r.guest.client.joinSession({ sessionId: host.id }); r.guest.handle = guest; cleanup.push(() => guest.leave().catch(() => undefined)); await until(() => guest.state === 'live', 8000);
  const a = await person(host, 'ana/db'); const b = await person(guest, 'bob/ui');
  const view = (side: typeof a) => side.bridge.team!.snapshot();
  const agentsOf = (side: typeof a, member: string) => view(side).members.find((m) => m.id === member)?.agents ?? [];
  return { r, host, guest, a, b, view, agentsOf };
}

describe('branch mode: each person runs their own agent in one session', { timeout: 30_000 }, () => {
  it('both agents appear in both team views, with provider, branch and state', async () => {
    const { host, guest, a, b, agentsOf } = await setup();
    await until(() => agentsOf(a, guest.me.id).length === 1 && agentsOf(b, host.me.id).length === 1, 8000);
    expect(agentsOf(b, host.me.id)[0]).toMatchObject({ mode: 'branch', owner: host.me.id }); await until(() => agentsOf(b, host.me.id)[0]?.branch === 'ana/db' && agentsOf(a, guest.me.id)[0]?.branch === 'bob/ui', 8000);
    expect(agentsOf(b, host.me.id)[0]).toMatchObject({ ahead: 1, behind: 0, dirty: true });
    await a.ctl.submit('hello from ana'); await until(() => agentsOf(b, host.me.id)[0]?.lastSaid?.startsWith('Ana') === true || (agentsOf(b, host.me.id)[0]?.lastSaid ?? '').includes('hello from ana'), 8000);
    await until(() => !a.ctl.state.busy && ['idle', 'thinking'].includes(agentsOf(b, host.me.id)[0]?.state ?? ''), 8000);
  });
  it('turning activity sharing off keeps state and branch flowing but stops the messages', async () => {
    const r = await rig(); cleanup.push(() => r.stop());
    const host = await r.host.client.createSession({ name: 'quiet', workspace: WS }); r.host.handle = host; cleanup.push(() => host.leave().catch(() => undefined));
    const guest = await r.guest.client.joinSession({ sessionId: host.id }); r.guest.handle = guest; cleanup.push(() => guest.leave().catch(() => undefined)); await until(() => guest.state === 'live', 8000);
    const a = await person(host, 'ana/db', { shareActivity: false }); const b = await person(guest, 'bob/ui'); const seen: string[] = []; guest.onAny((e) => seen.push(e.kind));
    await a.ctl.submit('secret plans'); await until(() => !a.ctl.state.busy); await new Promise((res) => setTimeout(res, 300));
    expect(seen).toContain('agent.spawn'); expect(seen.some((k) => k.startsWith('message.') || k.startsWith('tool.'))).toBe(false); expect(a.bridge.sharingActivity).toBe(false);
    const agent = b.bridge.team!.snapshot().members.find((m) => m.id === host.me.id)?.agents[0]; expect(agent?.sharing).toBe(false); expect(agent?.lastSaid).toBeUndefined();
    a.bridge.setShareActivity(true); await a.ctl.submit('now shared'); await until(() => seen.includes('message.user'), 8000);
  });
  it('a file one agent has locked is shown to the other; the second agent that touches it gets the conflict warning', async () => {
    const { host, guest, a, b, agentsOf } = await setup(); await until(() => agentsOf(b, host.me.id).length === 1, 8000);
    expect((await a.locks.acquire('src/db.ts', { agentId: a.agent as never })).ok).toBe(true);
    await until(() => agentsOf(b, host.me.id)[0]?.locks.some((l) => l.path === 'src/db.ts') === true, 8000); expect(b.bridge.team!.holderOf('src/db.ts')).toMatchObject({ name: expect.any(String) });
    const r2 = await b.locks.acquire('src/db.ts', { agentId: b.agent as never }); expect(r2.ok).toBe(true); // advisory: it never stops anyone
    if (r2.ok) expect(r2.heldBy).toBeTruthy(); await until(() => b.conflicts.length === 1 || a.conflicts.length === 1, 8000);
    const named = b.ctl.agentName(agentsOf(b, host.me.id)[0]!.id); expect(named).toMatch(/agent$/);
    await a.locks.release('src/db.ts', a.agent as never); await until(() => (agentsOf(b, host.me.id)[0]?.locks.length ?? 1) === 0, 8000);
    void guest;
  });
  it('after a conflict the local agent is told once, with the teammate named, in its next message', async () => {
    const { host, a, b, agentsOf } = await setup(); await until(() => agentsOf(b, host.me.id).length === 1, 8000); await a.locks.acquire('src/db.ts', { agentId: a.agent as never }); await until(() => agentsOf(b, host.me.id)[0]?.locks.length === 1, 8000);
    await b.locks.acquire('src/db.ts', { agentId: b.agent as never });     await until(() => b.bridge.team!.snapshot().conflicts.length === 1 && b.bridge.team!.digestFor(b.bridge.team!.snapshot().members.find((m) => m.you)!.id).length === 1, 8000);
    await b.ctl.submit('edit db'); await until(() => !b.ctl.state.busy); const told = b.ctl.state.items.filter((i) => i.kind === 'notice' && /teammate's agent is working on a file/.test((i as { text: string }).text)); expect(told).toHaveLength(1); expect((told[0] as { detail?: string }).detail).toMatch(/agent has /);
    await b.ctl.submit('edit again'); await until(() => !b.ctl.state.busy); expect(b.ctl.state.items.filter((i) => i.kind === 'notice' && /teammate's agent is working on a file/.test((i as { text: string }).text))).toHaveLength(1); // not repeated
  });
  it('someone who joins later still sees the agents that were there first', async () => {
    const r = await rig(); cleanup.push(() => r.stop()); const host = await r.host.client.createSession({ name: 'late', workspace: WS }); r.host.handle = host; cleanup.push(() => host.leave().catch(() => undefined));
    const a = await person(host, 'ana/db'); await new Promise((x) => setTimeout(x, 800));
    const guest = await r.guest.client.joinSession({ sessionId: host.id }); r.guest.handle = guest; cleanup.push(() => guest.leave().catch(() => undefined)); await until(() => guest.state === 'live', 8000);
    const b = await person(guest, 'bob/ui'); await until(() => (b.bridge.team!.snapshot().members.find((m) => m.id === host.me.id)?.agents.length ?? 0) === 1, 12000); void a;
  });
  it('an agent that leaves the session says so and its locks go', async () => {
    const { host, guest, a, b, agentsOf } = await setup(); await until(() => agentsOf(b, host.me.id).length === 1, 8000); await a.locks.acquire('x.ts', { agentId: a.agent as never }); await until(() => agentsOf(b, host.me.id)[0]?.locks.length === 1, 8000);
    a.bridge.stop(); await until(() => agentsOf(b, host.me.id)[0]?.state === 'exited', 8000); expect(agentsOf(b, host.me.id)[0]?.locks).toEqual([]); void guest;
  });
  it('a handoff is offered, accepted by the other person and seen by the sender', async () => {
    const { host, guest, a, b, view, agentsOf } = await setup(); await until(() => agentsOf(b, host.me.id).length === 1, 8000);
    const id = a.bridge.offerHandoff(guest.me.id, 'finish the migration tests'); await until(() => view(b).handoffs.some((h) => h.id === id && h.state === 'offered'), 8000);
    expect(view(b).handoffs.find((h) => h.id === id)).toMatchObject({ from: host.me.id, to: guest.me.id, note: 'finish the migration tests' });
    b.bridge.answerHandoff(id, true); await until(() => view(a).handoffs.find((h) => h.id === id)?.state === 'accepted', 8000);
    a.bridge.answerHandoff(id, false); await new Promise((res) => setTimeout(res, 200)); expect(view(a).handoffs.find((h) => h.id === id)?.state).toBe('accepted'); // only the target answers
  });
  it('nobody can make this person\'s agent run something by asking: there is no queue in branch mode', async () => {
    const { host, guest, a } = await setup(); const { QueueClient } = await import('@centcom/net'); const q = new QueueClient(guest); await q.submit({ body: 'rm -rf everything' }).catch(() => undefined);
    await new Promise((res) => setTimeout(res, 400)); expect(a.ctl.state.items.some((i) => i.kind === 'user')).toBe(false); expect(host.me.role).toBe('host');
  });
});
