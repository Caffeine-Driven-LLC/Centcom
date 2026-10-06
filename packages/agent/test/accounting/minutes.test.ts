import { describe, expect, it } from 'vitest';
import { AGENT, SESSION, report, rig } from './rig.js';

describe('agent minutes', () => {
  it('90 s thinking, 30 s awaiting approval, 60 s editing: 150 s, one agent_minutes event of 2 now and the rest carried', () => {
    const { ledger, advance, at } = rig(); ledger.onUsageReport(report({ tokensIn: 0 }));
    ledger.onAgentState(AGENT, 'thinking', at()); advance(90_000); ledger.onAgentState(AGENT, 'awaiting-approval', at()); advance(30_000); ledger.onAgentState(AGENT, 'editing-file', at()); advance(60_000); ledger.onAgentState(AGENT, 'idle', at());
    expect(ledger.snapshot({ agentId: AGENT }).agentMs).toBe(150_000); const mins = ledger.dequeueBatch().filter((e) => e.type === 'agent_minutes');
    expect(mins.reduce((a, e) => a + e.qty, 0)).toBe(2); expect(mins.every((e) => e.session_id === SESSION && e.agent_id === AGENT)).toBe(true);
    ledger.onAgentState(AGENT, 'running-command', at()); advance(30_000); ledger.onAgentState(AGENT, 'ready', at()); // 30 s carried + 30 s = the third minute
    expect(ledger.dequeueBatch().filter((e) => e.type === 'agent_minutes').map((e) => e.qty)).toEqual([1]); expect(ledger.snapshot({}).agentMs).toBe(180_000);
  });
  it('180 s of work in one stretch is 3 whole minutes', () => {
    const { ledger, advance, at } = rig(); ledger.onAgentState(AGENT, 'thinking', at()); advance(180_000); ledger.onAgentState(AGENT, 'sleeping', at()); expect(ledger.dequeueBatch().map((e) => e.qty)).toEqual([3]);
  });
  it('idle-like states never count', () => {
    const { ledger, advance, at } = rig(); for (const s of ['idle', 'ready', 'sleeping', 'away', 'awaiting-approval', 'asking-question']) { ledger.onAgentState(AGENT, s, at()); advance(600_000); }
    ledger.onAgentState(AGENT, 'idle', at()); expect(ledger.snapshot({}).agentMs).toBe(0); expect(ledger.pending()).toBe(0);
  });
});
