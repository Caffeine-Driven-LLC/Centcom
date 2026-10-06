import { describe, expect, it } from 'vitest';
import type { EventBody } from '../../src/types.js';
import { harness } from './helpers.js';

const claude: EventBody[] = [
  { type: 'turn.started', turn_id: 't1' }, { type: 'thinking.delta', message_id: 'm1', text: 'hm' },
  { type: 'tool.requested', tool_id: 'tu_1', name: 'Read', input_summary: 'src/a.ts', risk: 'low', path: 'src/a.ts' }, { type: 'tool.requested', tool_id: 'tu_2', name: 'Edit', input_summary: 'src/a.ts', risk: 'medium', path: 'src/a.ts' },
  { type: 'approval.requested', approval_id: 'apr_1', tool_id: 'tu_2', summary: 'edit', risk: 'medium', path: 'src/a.ts' }, { type: 'approval.resolved', approval_id: 'apr_1', decision: 'approve', scope: 'once', by: 'user' }, { type: 'turn.done', outcome: 'ok' },
];
// Codex has no Read/Edit tools: it reads with a shell command and edits with apply_patch. Same logical sequence.
const codex: EventBody[] = [
  { type: 'turn.started', turn_id: 'turn_9' }, { type: 'thinking.delta', message_id: 'r1', text: '' },
  { type: 'tool.requested', tool_id: 'call_1', name: 'shell', input_summary: 'cat src/a.ts', risk: 'low', command: 'cat src/a.ts' }, { type: 'tool.requested', tool_id: 'call_2', name: 'apply_patch', input_summary: 'patch', risk: 'medium', path: 'src/a.ts' },
  { type: 'approval.requested', approval_id: 'apr_9', tool_id: 'call_2', summary: 'patch', risk: 'medium' }, { type: 'approval.resolved', approval_id: 'apr_9', decision: 'approve', scope: 'once', by: 'user' }, { type: 'turn.done', outcome: 'ok' },
];
const EXPECTED = ['prompt-received', 'thinking', 'reading-file', 'editing-file', 'awaiting-approval', 'approved', 'editing-file', 'success', 'idle'];

async function replay(events: EventBody[]) {
  const h = harness(); for (const b of events.slice(0, 6)) h.push(b); await h.settle(800); // approved lasts 800 ms
  h.push(events[6]!); await h.settle(2000); return h;
}

describe('golden transcripts', () => {
  it('claude-edit-with-approval gives exactly the contract sequence with the right dwell times', async () => {
    const h = harness(); for (const b of claude.slice(0, 6)) h.push(b); await h.settle(799); expect(h.machine.at(-1)).toBe('approved'); await h.settle(1); expect(h.machine.at(-1)).toBe('editing-file');
    h.push(claude[6]!); expect(h.machine.at(-1)).toBe('success'); await h.settle(1999); expect(h.machine.at(-1)).toBe('success'); await h.settle(1); expect(h.machine.at(-1)).toBe('idle'); expect(h.machine).toEqual(EXPECTED);
  });
  it('codex gives the identical list (engine independence)', async () => { const a = await replay(claude); const b = await replay(codex); expect(b.machine).toEqual(a.machine); expect(b.machine).toEqual(EXPECTED); });
  it('on the wire the same run is the agent-level subset: no prompt-received, and short states can be merged by the rate limit', async () => {
    const h = await replay(claude); expect(h.local).toContain('prompt-received'); expect(h.sends.every((s) => s.state !== ('prompt-received' as never))).toBe(true); expect(h.sends.at(-1)!.state).toBe('idle'); expect(h.sends.length).toBeLessThanOrEqual(EXPECTED.length);
  });
});

describe('timers', () => {
  it('thinking with no output for 15 s becomes thinking-hard; any output keeps it thinking', async () => {
    const h = harness(); h.push({ type: 'turn.started', turn_id: 't' }); h.push({ type: 'thinking.delta', message_id: 'm', text: '' }); await h.settle(14_999); expect(h.machine.at(-1)).toBe('thinking'); await h.settle(1); expect(h.machine.at(-1)).toBe('thinking-hard');
    const k = harness(); k.push({ type: 'turn.started', turn_id: 't' }); k.push({ type: 'thinking.delta', message_id: 'm', text: '' }); for (let i = 0; i < 5; i++) { await k.settle(10_000); k.push({ type: 'thinking.delta', message_id: 'm', text: '' }); } expect(k.machine.at(-1)).toBe('thinking');
  });
  it('idle becomes sleeping after 15 minutes and a new turn wakes it', async () => {
    const h = harness(); h.push({ type: 'turn.started', turn_id: 't' }); h.push({ type: 'turn.done', outcome: 'canceled' }); await h.settle(15 * 60_000 - 1); expect(h.machine.at(-1)).toBe('idle'); await h.settle(1); expect(h.machine.at(-1)).toBe('sleeping'); expect(h.local).toContain('sleeping');
    h.push({ type: 'turn.started', turn_id: 't2' }); expect(h.machine.at(-1)).toBe('prompt-received');
  });
  it('prompt-received lasts 600 ms and then falls back to idle-or-thinking', async () => { const h = harness(); h.push({ type: 'turn.started', turn_id: 't' }); await h.settle(599); expect(h.machine.at(-1)).toBe('prompt-received'); await h.settle(1); expect(h.machine.at(-1)).toBe('thinking'); });
  it('approval and question persist indefinitely', async () => { const h = harness(); h.push({ type: 'approval.requested', approval_id: 'apr_1', tool_id: 't', summary: '', risk: 'low' }); await h.settle(3_600_000); expect(h.machine.at(-1)).toBe('awaiting-approval'); const q = harness(); q.push({ type: 'question.asked', question_id: 'q', text: '' }); await q.settle(3_600_000); expect(q.machine.at(-1)).toBe('asking-question'); });
  it('crash from any state ends the machine; interrupt returns to idle at once; stale timers do nothing', async () => {
    const h = harness(); h.push({ type: 'turn.started', turn_id: 't' }); h.push({ type: 'tool.requested', tool_id: 'a', name: 'Edit', input_summary: '', risk: 'low' }); h.exit('crash'); expect(h.machine.at(-1)).toBe('crash'); h.push({ type: 'text.delta', message_id: 'm', index: 0, text: '' }); await h.settle(60 * 60_000); expect(h.machine.at(-1)).toBe('crash'); expect(h.clock.pending()).toBe(0);
    const i = harness(); i.push({ type: 'turn.started', turn_id: 't' }); i.push({ type: 'thinking.delta', message_id: 'm', text: '' }); i.bus.emit('agent:exited', { agent_id: i.machine ? 'agt_01JTEST0000000000000000001' as never : 'x' as never, outcome: 'canceled' }); expect(i.machine.at(-1)).toBe('idle');
  });
  it('dispose removes every timer and ignores later events', async () => { const h = harness(); h.push({ type: 'turn.started', turn_id: 't' }); h.att.dispose(); expect(h.clock.pending()).toBe(0); const n = h.machine.length; h.push({ type: 'text.delta', message_id: 'm', index: 0, text: '' }); expect(h.machine.length).toBe(n); });
  it('cap hint reaches the UI while the wire state stays warning', async () => { const h = harness(); h.push({ type: 'error', code: 'provider_cap_reached', tool_message: '', fatal: false }); expect(h.hints).toEqual(['provider-cap-reached']); expect(h.machine.at(-1)).toBe('warning'); expect(h.sends.at(-1)!.state).toBe('warning'); });
});
