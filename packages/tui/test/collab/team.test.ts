import { describe, expect, it } from 'vitest';
import type { DecodedEvent, MemberInfo } from '@centcom/net';
import { TeamModel } from '../../src/collab/team.js';

const ME = 'mem_ME'; const ANA = 'mem_ANA'; const HOST = 'mem_HOST';
const roster = (): MemberInfo[] => [{ id: HOST, name: 'Host', role: 'host', slot: 0, online: true } as MemberInfo, { id: ME, name: 'Me', role: 'editor', slot: 1, online: true } as MemberInfo, { id: ANA, name: 'Ana', role: 'editor', slot: 2, online: true } as MemberInfo];
let seq = 0;
const ev = (kind: string, from: string, p: Record<string, unknown> = {}, secret: Record<string, unknown> = {}, ts = new Date().toISOString()): DecodedEvent => ({ kind, from, p, secret, seq: ++seq, id: `msg_${seq}`, ts, verified: true });
const spawn = (from: string, agent: string, extra: Record<string, unknown> = {}) => ev('agent.spawn', from, { agent_id: agent, owner: from, mode: 'branch', runs_on: from, provider: 'anthropic' }, { label: 'Claude Code', branch: 'ana/db', ...extra });

describe('the team view', () => {
  it('shows each member with their own agents, states and branches', () => {
    const t = new TeamModel(); t.setRoster(roster(), ME); t.apply(spawn(ANA, 'agt_A')); t.apply(spawn(ME, 'agt_M', { branch: 'me/ui' }));
    t.apply(ev('agent.state', ANA, { agent_id: 'agt_A', state: 'thinking', since: 'now' })); t.apply(ev('branch.update', ANA, {}, { agent_id: 'agt_A', branch: 'ana/db', head: 'abc123', ahead: 2, behind: 11, dirty: true }));
    const v = t.snapshot(); const ana = v.members.find((m) => m.id === ANA)!; expect(ana.agents).toHaveLength(1); expect(ana.agents[0]).toMatchObject({ provider: 'anthropic', state: 'thinking', branch: 'ana/db', ahead: 2, behind: 11, dirty: true, label: 'Claude Code' });
    expect(v.members.find((m) => m.you)?.agents[0]?.branch).toBe('me/ui'); expect(v.hints.join(' ')).toMatch(/Ana's agent is 11 commits behind/);
  });
  it('ignores a frame for an agent its sender does not own (only the host may speak for any)', () => {
    const t = new TeamModel(); t.setRoster(roster(), ME); t.apply(spawn(ANA, 'agt_A'));
    t.apply(ev('agent.state', ME, { agent_id: 'agt_A', state: 'crash', since: 'x' })); expect(t.snapshot().members.find((m) => m.id === ANA)?.agents[0]?.state).toBe('idle');
    t.apply(ev('agent.state', HOST, { agent_id: 'agt_A', state: 'away', since: 'x' })); expect(t.snapshot().members.find((m) => m.id === ANA)?.agents[0]?.state).toBe('away');
    t.apply(ev('agent.spawn', ME, { agent_id: 'agt_X', owner: ANA, mode: 'branch' })); expect(t.snapshot().members.flatMap((m) => m.agents).some((a) => a.id === 'agt_X')).toBe(false); // spawning for someone else
  });
  it('tracks the files an agent has locked, until released, expired or the agent exits', () => {
    let now = 1_000_000; const t = new TeamModel({ now: () => now }); t.setRoster(roster(), ME); t.apply(spawn(ANA, 'agt_A'));
    t.apply(ev('file.lock', ANA, { action: 'acquire', path_hmac: 'h1', agent_id: 'agt_A', ttl_ms: 10_000 }, { path: 'src/db.ts' }, new Date(now).toISOString()));
    const lockOf = () => t.snapshot().members.find((m) => m.id === ANA)!.agents[0]!.locks.map((l) => l.path); expect(lockOf()).toEqual(['src/db.ts']); expect(t.holderOf('src/db.ts')).toMatchObject({ name: 'Ana', agent: 'agt_A' });
    now += 11_000; (t as unknown as { dirty: boolean }).dirty = true; expect(lockOf()).toEqual([]);
    t.apply(ev('file.lock', ANA, { action: 'acquire', path_hmac: 'h2', agent_id: 'agt_A', ttl_ms: 60_000 }, { path: 'a.ts' }, new Date(now).toISOString())); expect(lockOf()).toEqual(['a.ts']);
    t.apply(ev('file.lock', ANA, { action: 'release', path_hmac: 'h2', agent_id: 'agt_A' })); expect(lockOf()).toEqual([]);
    t.apply(ev('file.lock', ANA, { action: 'acquire', path_hmac: 'h3', agent_id: 'agt_A', ttl_ms: 60_000 }, { path: 'b.ts' }, new Date(now).toISOString())); t.apply(ev('agent.exit', ANA, { agent_id: 'agt_A', outcome: 'ok' }));
    expect(lockOf()).toEqual([]); expect(t.snapshot().members.find((m) => m.id === ANA)?.agents[0]?.state).toBe('exited');
  });
  it('says what a teammate\'s agent last said, and when an agent waits for its owner', () => {
    const t = new TeamModel(); t.setRoster(roster(), ME); t.apply(spawn(ANA, 'agt_A'));
    t.apply(ev('message.user', ANA, {}, { text: 'add a migration', agent_id: 'agt_A' })); expect(t.snapshot().members.find((m) => m.id === ANA)?.agents[0]?.lastSaid).toBe('Ana: add a migration');
    t.apply(ev('message.assistant.delta', ANA, {}, { agent_id: 'agt_A', message_id: 'msg_1', index: 0, delta: 'Done: ' })); t.apply(ev('message.assistant.delta', ANA, {}, { agent_id: 'agt_A', message_id: 'msg_1', index: 1, delta: 'created 0007.sql' }));
    expect(t.snapshot().members.find((m) => m.id === ANA)?.agents[0]?.lastSaid).toBe('Done: created 0007.sql'); expect(t.snapshot().members.find((m) => m.id === ANA)?.agents[0]?.sharing).toBe(true);
    t.apply(ev('agent.state', ANA, { agent_id: 'agt_A', state: 'awaiting-approval', since: 'x' })); t.apply(ev('approval.request', ANA, { approval_id: 'apr_1', agent_id: 'agt_A', risk: 'high' })); expect(t.snapshot().members.find((m) => m.id === ANA)?.agents[0]?.waiting).toEqual({ approval: 'apr_1', risk: 'high' });
  });
  it('records conflicts and gives each owner one line about the other agent', () => {
    const t = new TeamModel(); t.setRoster(roster(), ME); t.apply(spawn(ANA, 'agt_A')); t.apply(spawn(ME, 'agt_M'));
    t.apply(ev('conflict.detected', HOST, { agent_ids: ['agt_M', 'agt_A'], path_hmacs: ['h1'] }, { paths: ['src/db.ts'] })); expect(t.snapshot().conflicts).toHaveLength(1);
    expect(t.digestFor(ME)).toEqual(["Ana's agent has src/db.ts."]); expect(t.digestFor(ANA)).toEqual(['Me\'s agent has src/db.ts.']);
  });
  it('handoffs: only the target can accept or decline, and an offer is made once', () => {
    const t = new TeamModel(); t.setRoster(roster(), ME); t.apply(spawn(ANA, 'agt_A'));
    t.apply(ev('agent.handoff', ANA, { handoff: 'h1', agent_id: 'agt_A', to: ME, op: 'offer' }, { note: 'finish the tests' })); expect(t.snapshot().handoffs).toEqual([expect.objectContaining({ id: 'h1', from: ANA, to: ME, state: 'offered', note: 'finish the tests' })]);
    t.apply(ev('agent.handoff', HOST, { handoff: 'h1', agent_id: 'agt_A', to: ME, op: 'accept' })); expect(t.snapshot().handoffs[0]?.state).toBe('offered');
    t.apply(ev('agent.handoff', ME, { handoff: 'h1', agent_id: 'agt_A', to: ME, op: 'accept' })); expect(t.snapshot().handoffs[0]?.state).toBe('accepted');
  });
  it('malformed frames do nothing', () => { const t = new TeamModel(); t.setRoster(roster(), ME); for (const k of ['agent.spawn', 'agent.state', 'file.lock', 'branch.update', 'conflict.detected', 'agent.handoff']) t.apply({ kind: k, from: ANA, seq: 1, id: 'x', ts: 'x', verified: true } as DecodedEvent); expect(t.snapshot().members.flatMap((m) => m.agents)).toEqual([]); });
});
