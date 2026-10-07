import { describe, expect, it } from 'vitest';
import { AGENT_WIRE_STATES } from '@centcom/protocol';
import { FleetSync, KeyRing, initCrypto, LocalStateError, SpawnRejectedError, UnknownStateError, bridgeBus, checkWireState, type SessionHandle } from '../../src/index.js';
import { ManualClock } from '../session/rig.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

await initCrypto();
const MAP = Object.keys(JSON.parse(readFileSync(join(import.meta.dirname, '../../../../contracts/state-map.json'), 'utf8')) as Record<string, string>);
function stub() {
  const sent: { kind: string; body: { p?: Record<string, unknown>; secret?: Record<string, unknown>; id?: string } }[] = []; let fail: unknown;
  const session = { me: { id: 'mem_ME', role: 'editor', slot: 0 }, state: 'live', roster: () => [{ id: 'mem_ME', role: 'editor', slot: 0 }], sendEvent: async (kind: string, body: never) => { if (fail) throw fail; sent.push({ kind, body }); return { id: 'msg_x', seq: 1 }; }, onAny: () => () => undefined, on: () => () => undefined, abandon: () => undefined } as unknown as SessionHandle;
  return { session, sent, failWith: (e: unknown) => { fail = e; } };
}
const mk = () => { const clock = new ManualClock(); const s = stub(); const ring = KeyRing.create(); const f = new FleetSync(s.session, { ring: () => ring, clock }); return { clock, ...s, f }; };
const A = 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V4W';

describe('state names (acceptance 1)', () => {
  it('every name in the map is either sendable or a local-only state; the wire ones are accepted, anything else is refused with nothing sent', () => {
    expect(MAP.length).toBeGreaterThanOrEqual(60); let ok = 0; let local = 0; for (const n of MAP) { try { checkWireState(n); ok++; } catch (e) { expect(e).toBeInstanceOf(LocalStateError); local++; } } expect(ok).toBe(AGENT_WIRE_STATES.length); expect(ok + local).toBe(MAP.length); for (const n of ['offline', 'reconnecting', 'quota-reached', 'teammate-joins']) expect(() => checkWireState(n), n).toThrow(LocalStateError);
    const { f, sent } = mk(); for (const bad of ['warp-drive', '', 'IDLE', 'idle ']) expect(() => f.setState(A, bad)).toThrow(UnknownStateError); expect(sent).toHaveLength(0);
  });
  it('the same state twice sends once; ten changes in a second send at most two frames, the last one wins', async () => {
    const { f, sent, clock } = mk(); f.setState(A, 'idle'); f.setState(A, 'idle'); expect(sent).toHaveLength(1); await clock.advance(1000); const names = AGENT_WIRE_STATES.filter((s) => s !== 'idle'); for (let i = 0; i < 10; i++) { f.setState(A, names[i]!); await clock.advance(90); } const n = sent.length - 1; expect(n).toBeLessThanOrEqual(3); await clock.advance(600); expect(sent.at(-1)!.body.p).toMatchObject({ state: names[9] });
    const t0 = sent.length; await clock.advance(5000); expect(sent.length).toBe(t0); const two = mk(); two.f.setState(A, 'planning'); two.f.setState(A, 'searching'); expect(two.sent).toHaveLength(1); await two.clock.advance(501); expect(two.sent).toHaveLength(2); expect(two.sent.at(-1)!.body.p!.state).toBe('searching');
  });
  it('another agent has its own pace', () => { const { f, sent } = mk(); f.setState(A, 'idle'); f.setState('agt_01JA3Z8K2M5N7P9Q0R1S2T3V5X', 'idle'); expect(sent).toHaveLength(2); });
});
describe('shapes and privacy (acceptance 2, 5)', () => {
  it('agent.state is clear only; agent.spawn keeps label, branch, worktree and model in the secret part; branch.update is secret only', async () => {
    const { f, sent } = mk(); f.setState(A, 'editing-file'); await f.spawn({ agentId: A, mode: 'branch', label: 'LABEL-1', branch: 'BRANCH-1', worktree: '/WT-1', model: 'MODEL-1' }); await f.updateBranch({ agentId: A, branch: 'BRANCH-1', head: 'HEAD-1', ahead: 1, behind: 2, dirty: true }); await f.exit(A, 'error', 'oops', 'DETAIL-1');
    const st = sent.find((s) => s.kind === 'agent.state')!; expect(st.body.secret).toBeUndefined(); expect(Object.keys(st.body.p!).sort()).toEqual(['agent_id', 'since', 'state']); const sp = sent.find((s) => s.kind === 'agent.spawn')!; expect(JSON.stringify(sp.body.p)).not.toMatch(/LABEL-1|BRANCH-1|WT-1|MODEL-1/); expect(sp.body.secret).toEqual({ label: 'LABEL-1', branch: 'BRANCH-1', worktree: '/WT-1', model: 'MODEL-1' }); expect(sp.body.p).toMatchObject({ agent_id: A, owner: 'mem_ME', mode: 'branch' });
    const bu = sent.find((s) => s.kind === 'branch.update')!; expect(bu.body.p).toBeUndefined(); expect(bu.body.secret).toMatchObject({ agent_id: A, branch: 'BRANCH-1', head: 'HEAD-1', ahead: 1, behind: 2, dirty: true }); const ex = sent.find((s) => s.kind === 'agent.exit')!; expect(ex.body.p).toEqual({ agent_id: A, outcome: 'error', error_code: 'oops' }); expect(ex.body.secret).toEqual({ detail: 'DETAIL-1' });
  });
  it('a conflict carries the keyed hashes in the clear and the paths only inside the secret part', async () => { const { f, sent } = mk(); await f.reportConflict([A], ['src/CANARY-path.ts']); const c = sent.find((s) => s.kind === 'conflict.detected')!; expect(JSON.stringify(c.body.p)).not.toContain('CANARY'); expect((c.body.p!.path_hmacs as string[])[0]).toMatch(/^[A-Za-z0-9_-]{20,}$/); expect(c.body.secret).toEqual({ paths: ['src/CANARY-path.ts'] }); });
});
describe('spawn limit (acceptance 9)', () => {
  it('a refusal for the plan limit is a typed error and nothing is recorded as started', async () => { const { f, failWith } = mk(); const { CentcomError } = await import('../../src/index.js'); failWith(new CentcomError({ kind: 'api', code: 'quota_exceeded', status: 403 })); await expect(f.spawn({ agentId: A, mode: 'branch' })).rejects.toBeInstanceOf(SpawnRejectedError); failWith(new Error('boom')); await expect(f.spawn({ agentId: A, mode: 'branch' })).rejects.toThrow('boom'); });
});
describe('bridge from the local bus', () => {
  it('started, state, exited map to spawn, setState and exit; crash is an error; local-only states and missing worktrees are handled', async () => {
    const { f, sent } = mk(); const handlers = new Map<string, (p: never) => unknown>(); const bus = { on: (k: string, h: (p: never) => unknown) => { handlers.set(k, h); return () => handlers.delete(k); } }; const off = bridgeBus(bus, f, { mode: 'branch', shareDetails: true });
    handlers.get('worktree:created')!({ agent_id: A, path: '/wt/a', branch: 'feat/a' } as never); handlers.get('agent:started')!({ agent_id: A, model: 'm1', cwd: '/x' } as never); handlers.get('agent:state_changed')!({ agent_id: A, state: 'thinking' } as never); handlers.get('agent:state_changed')!({ agent_id: A, state: 'offline' } as never); handlers.get('agent:exited')!({ agent_id: A, outcome: 'crash' } as never); await new Promise((x) => setTimeout(x, 20));
    expect(sent.map((s) => s.kind)).toEqual(['agent.spawn', 'agent.state', 'agent.exit']); expect(sent[0]!.body.secret).toMatchObject({ branch: 'feat/a', worktree: '/wt/a', model: 'm1' }); expect(sent[2]!.body.p).toMatchObject({ outcome: 'error', error_code: 'crash' }); off(); expect(handlers.size).toBe(0);
  });
});
