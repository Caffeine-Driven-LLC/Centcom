import { describe, expect, it } from 'vitest';
import type { DecodedEvent, MemberInfo } from '@centcom/net';
import { TeamModel, safeText } from '../../src/collab/team.js';
import { renderTranscript } from '../../src/collab/team-text.js';

const ME = 'mem_ME'; const ANA = 'mem_ANA'; const BOB = 'mem_BOB';
const roster = (): MemberInfo[] => [{ id: ME, name: 'Me', role: 'host', slot: 0, online: true } as MemberInfo, { id: ANA, name: 'Ana', role: 'editor', slot: 1, online: true } as MemberInfo, { id: BOB, name: 'Bob', role: 'editor', slot: 2, online: true } as MemberInfo];
let seq = 0;
const ev = (kind: string, from: string, p: Record<string, unknown> = {}, secret: Record<string, unknown> = {}): DecodedEvent => ({ kind, from, p, secret, seq: ++seq, id: `msg_${seq}`, ts: '2026-10-05T18:00:00.000Z', verified: true });
const model = () => { const t = new TeamModel(); t.setRoster(roster(), ME); t.apply(ev('agent.spawn', ANA, { agent_id: 'agt_A', owner: ANA, mode: 'branch', provider: 'anthropic' }, { label: 'Claude Code' })); return t; };

describe("a teammate's transcript (read only)", () => {
  it("keeps what the owner asked, what the agent said (deltas joined) and the tools it ran, in order", () => {
    const t = model();
    t.apply(ev('message.user', ANA, {}, { text: 'add a migration', agent_id: 'agt_A' }));
    t.apply(ev('message.assistant.delta', ANA, {}, { agent_id: 'agt_A', message_id: 'msg_1', index: 0, delta: 'Looking at ' })); t.apply(ev('message.assistant.delta', ANA, {}, { agent_id: 'agt_A', message_id: 'msg_1', index: 1, delta: 'the schema.' })); t.apply(ev('message.assistant.done', ANA, {}, { agent_id: 'agt_A', message_id: 'msg_1' }));
    t.apply(ev('tool.request', ANA, {}, { agent_id: 'agt_A', tool_id: 't1', name: 'Bash', input_summary: 'pnpm test', risk: 'low' })); t.apply(ev('tool.result', ANA, {}, { agent_id: 'agt_A', tool_id: 't1', status: 'error', summary: '2 failed' }));
    t.apply(ev('message.system', ANA, {}, { level: 'warn', text: 'rate limited' }));
    const lines = t.transcript('agt_A'); expect(lines.map((l) => [l.kind, l.text])).toEqual([['user', 'add a migration'], ['assistant', 'Looking at the schema.'], ['tool', 'pnpm test → 2 failed'], ['system', 'rate limited']]);
    expect(lines[1]!.done).toBe(true); expect(lines[2]).toMatchObject({ name: 'Bash', status: 'error' });
    expect(renderTranscript(lines, 'Ana')).toBe('Ana: add a migration\nagent: Looking at the schema.\n  · Bash pnpm test → 2 failed [error]\n~ rate limited');
  });
  it('only the agent owner (or the host) can add to it; another member cannot forge a teammate\'s transcript', () => {
    const t = model(); t.apply(ev('message.user', BOB, {}, { text: 'forged', agent_id: 'agt_A' })); expect(t.transcript('agt_A')).toEqual([]);
    t.apply(ev('message.user', ME, {}, { text: 'from the host', agent_id: 'agt_A' })); expect(t.transcript('agt_A')).toHaveLength(1);
  });
  it('removes terminal escape sequences and control codes from what another computer sent, and caps the size', () => {
    const t = model(); t.apply(ev('message.user', ANA, {}, { text: 'hi \u001b[31mred\u001b[0m \u001b]0;title\u0007 there\u0000 ‮', agent_id: 'agt_A' }));
    expect(t.transcript('agt_A')[0]!.text).toBe('hi red  there   '); expect(safeText('x'.repeat(9000)).length).toBeLessThanOrEqual(6000);
    for (let i = 0; i < 400; i++) t.apply(ev('message.user', ANA, {}, { text: `m${i}`, agent_id: 'agt_A' })); expect(t.transcript('agt_A')).toHaveLength(300); expect(t.transcript('agt_A').at(-1)!.text).toBe('m399');
  });
  it('is empty for an agent whose owner does not share its activity (nothing was sent)', () => { expect(model().transcript('agt_A')).toEqual([]); expect(renderTranscript([], 'Ana')).toBe(''); });
});
