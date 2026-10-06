import { describe, expect, it } from 'vitest';
import { createAgentBus, attachCheckpoints, type NormalisedEvent } from '../../src/index.js';
import { repo, rig } from './helpers.js';

const AGT = 'agt_01JTEST0000000000000000001';
const ev = (type: string, seq: number): NormalisedEvent => ({ type, v: 1, seq, ts: 't', agent_id: AGT, ...(type === 'turn.started' ? { turn_id: 'tu' } : { outcome: 'ok' }) } as never);
describe('wiring to the event bus', () => {
  it('a checkpoint on turn.started (before the first tool) and an end marker on turn.done', async () => {
    const r = repo(); const t = rig(r); const bus = createAgentBus({ onError: (e) => { throw e; } }); const off = attachCheckpoints(bus, AGT, t.mgr, { label: (n) => `prompt number ${n}`, engineSession: () => ({ id: 'eng-1' }) });
    bus.emit('agent:event', { agent_id: AGT, seq: 1, event: ev('turn.started', 1) }); await t.mgr.ready(); await new Promise((r2) => setTimeout(r2, 200)); expect(t.mgr.list().map((c) => [c.label, c.promptSeq, c.engineSession?.id])).toEqual([['prompt number 1', 1, 'eng-1']]);
    r.put('a.txt', 'agent\n'); bus.emit('agent:event', { agent_id: AGT, seq: 2, event: ev('turn.done', 2) }); await new Promise((r2) => setTimeout(r2, 300)); r.put('a.txt', 'user\n');
    const plan = await t.mgr.preview('ckp_1', 'files'); expect(plan.skippedModifiedOutside).toEqual(['a.txt']); // the end marker was written, so the later edit is known to be someone else's
    bus.emit('agent:event', { agent_id: 'agt_other', seq: 1, event: { ...ev('turn.started', 1), agent_id: 'agt_other' } }); await new Promise((r2) => setTimeout(r2, 100)); expect(t.mgr.list()).toHaveLength(1); off();
  });
  it('a failing checkpoint never breaks the stream', async () => { const r = repo(); const t = rig(r, { git: { run: async () => ({ code: 1, stdout: '', stderr: 'x' }) } }); const bus = createAgentBus({ onError: (e) => { throw e; } }); attachCheckpoints(bus, AGT, t.mgr, { label: () => 'x' }); expect(() => bus.emit('agent:event', { agent_id: AGT, seq: 1, event: ev('turn.started', 1) })).not.toThrow(); await new Promise((r2) => setTimeout(r2, 100)); expect(t.mgr.list().every((c) => c.commit === null)).toBe(true); });
});
describe('no external feature is used', () => { it('engine resume is used only through the capability', async () => { const r = repo(); const t = rig(r, { caps: [] }); const c = await t.mgr.create('x', { promptSeq: 1, engineSession: { id: 'e' } }); await t.mgr.rewind(c.id, 'conversation'); expect(t.starts[0]!.resume).toBeUndefined(); }); });
