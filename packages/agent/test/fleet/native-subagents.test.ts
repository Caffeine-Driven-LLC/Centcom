import { describe, expect, it } from 'vitest';
import { attachStateMachine, createStateEmitter, type MachineState } from '../../src/index.js';
import { fleetRig } from './helpers.js';

const child = [{ type: 'subagent.started' as const, subagent_id: 'sub_1', parent_tool_id: 'tool_1', label: 'research the api' }, { type: 'subagent.started' as const, subagent_id: 'sub_2', parent_tool_id: 'tool_1', label: 'write tests' }];
describe('native subagents (acceptance 7)', () => {
  it('a subagent event creates a child node under its parent and ends with its end event', async () => {
    const r = await fleetRig({ limit: 4, engineOpts: { 'claude-code': { script: { events: child, hang: true } } } }); const h = await r.fleet.spawn(r.spec(1)); await r.until(() => r.fleet.list().filter((n) => n.kind === 'subagent').length === 2);
    const kids = r.fleet.list().filter((n) => n.kind === 'subagent'); expect(kids.map((k) => [k.id, k.parent, k.label, k.state])).toEqual([['sub_1', h.id, 'research the api', 'running'], ['sub_2', h.id, 'write tests', 'running']]); expect(r.fleet.list().filter((n) => n.kind === 'agent')).toHaveLength(1);
    r.bus.emit('agent:event', { agent_id: h.id, seq: 99, event: { type: 'subagent.done', subagent_id: 'sub_1', status: 'ok', v: 1, seq: 99, ts: 't', agent_id: h.id } as never }); expect(r.fleet.list().find((n) => n.id === 'sub_1')!.state).toBe('done'); await r.fleet.stopAll(); expect(r.fleet.list().find((n) => n.id === 'sub_2')!.state).toBe('canceled');
  }, 60_000);
  it('children do not use a concurrency slot: with limit 1 and two children running, a second agent still waits for the first agent only', async () => {
    const r = await fleetRig({ limit: 1, engineOpts: { 'claude-code': { script: { events: child, hang: true } } } }); await r.fleet.spawn(r.spec(1)); const q = await r.fleet.spawn(r.spec(2)); await r.until(() => r.fleet.list().filter((n) => n.kind === 'subagent').length === 2); expect(q.state()).toBe('queued');
    const w = await fleetRig({ limit: 2, engineOpts: { 'claude-code': { script: { events: child, hang: true } } } }); await w.fleet.spawn(w.spec(1)); const second = await w.fleet.spawn(w.spec(2)); await w.until(() => w.engines['claude-code']!.sessions.length === 2); expect(second.state()).not.toBe('queued'); await r.fleet.stopAll(); await w.fleet.stopAll();
  }, 60_000);
  it('the parent shows the sub-agent state while a child runs (the state machine sees the same events)', async () => {
    const r = await fleetRig({ limit: 2, engineOpts: { 'claude-code': { script: { events: [child[0]!], hang: true } } } }); const seen: MachineState[] = []; const emitter = createStateEmitter({ clock: r.clock, send: () => undefined, onLocal: () => undefined }); attachStateMachine(r.bus, emitter, { clock: r.clock, plan: () => false, onState: (_a, s) => seen.push(s) });
    const h = await r.fleet.spawn(r.spec(1)); await r.until(() => r.fleet.list().some((n) => n.kind === 'subagent')); await r.tick(); expect(seen).toContain('sub-agent'); r.bus.emit('agent:event', { agent_id: h.id, seq: 50, event: { type: 'subagent.done', subagent_id: 'sub_1', status: 'ok', v: 1, seq: 50, ts: 't', agent_id: h.id } as never }); await r.tick(); expect(seen.at(-1)).not.toBe('sub-agent'); await r.fleet.stopAll();
  }, 60_000);
});
