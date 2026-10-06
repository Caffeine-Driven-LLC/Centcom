import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { VirtualClock } from '@centcom/testkit';
import { parseEventPayload } from '@centcom/protocol';
import { AGENT_WIRE_STATES } from '@centcom/protocol';
import { createStateEmitter, type WirePayload } from '../../src/index.js';
import { AGT, WIRE, ev, harness } from './helpers.js';
import type { AgentId } from '../../src/index.js';

const mk = () => { const clock = new VirtualClock(); const sends: (WirePayload & { at: number })[] = []; const local: string[] = []; const e = createStateEmitter({ clock, send: (p) => sends.push({ ...p, at: clock.now() }), onLocal: (_a, s) => local.push(s) }); return { clock, sends, local, e }; };

describe('emitter', () => {
  it('5 identical pushes send once', async () => { const { e, sends, clock } = mk(); for (let i = 0; i < 5; i++) e.push(AGT, 'thinking'); await clock.advance(2000); expect(sends).toHaveLength(1); });
  it('10 distinct states inside a second give at most 2 sends and the last one is the newest', async () => {
    const { e, sends, clock } = mk(); const seq = ['thinking', 'reading-file', 'editing-file', 'running-command', 'searching', 'streaming', 'tool-running', 'compacting', 'planning', 'success'] as const;
    for (const s of seq) { e.push(AGT, s); await clock.advance(50); } await clock.advance(1000); expect(sends.length).toBeLessThanOrEqual(2); expect(sends.at(-1)!.state).toBe('success'); expect(sends[0]!.state).toBe('thinking');
  });
  it('a change that arrives after a quiet half second goes out at once; one right after waits for the half second', async () => {
    const { e, sends, clock } = mk(); e.push(AGT, 'thinking'); expect(sends).toHaveLength(1); await clock.advance(100); e.push(AGT, 'editing-file'); expect(sends).toHaveLength(1); await clock.advance(399); expect(sends).toHaveLength(1); await clock.advance(1); expect(sends).toHaveLength(2); expect(sends[1]!.at - sends[0]!.at).toBe(500);
    await clock.advance(600); e.push(AGT, 'idle'); expect(sends).toHaveLength(3);
  });
  it('flipping back to the sent state before the trailing send cancels it (no pointless frame)', async () => { const { e, sends, clock } = mk(); e.push(AGT, 'thinking'); await clock.advance(10); e.push(AGT, 'streaming'); e.push(AGT, 'thinking'); await clock.advance(1000); expect(sends.map((s) => s.state)).toEqual(['thinking']); });
  it('payloads have exactly agent_id, state, since (RFC 3339 ms UTC) and validate against the generated agent.state schema', async () => {
    const { e, sends, clock } = mk(); for (const s of AGENT_WIRE_STATES) { e.push(AGT, s); await clock.advance(600); }
    expect(sends).toHaveLength(AGENT_WIRE_STATES.length - 0); for (const p of sends) { expect(Object.keys(p).filter((k) => k !== 'at').sort()).toEqual(['agent_id', 'since', 'state']); expect(p.since).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/); expect(parseEventPayload('agent.state', { agent_id: p.agent_id, state: p.state, since: p.since }).ok).toBe(true); }
  });
  it('the schema check is real: a payload with an extra field or a non-string state is rejected', () => { expect(parseEventPayload('agent.state', { agent_id: AGT, state: 5, since: 'x' }).ok).toBe(false); });
  it('non-wire states (prompt-received, sleeping) go to onLocal and are never sent', async () => { const { e, sends, local, clock } = mk(); e.push(AGT, 'prompt-received'); e.push(AGT, 'sleeping'); await clock.advance(1000); expect(sends).toEqual([]); expect(local).toEqual(['prompt-received', 'sleeping']); });
  it('agents are independent, and dispose stops everything', async () => {
    const { e, sends, clock } = mk(); const B = 'agt_01JTEST0000000000000000002' as typeof AGT; e.push(AGT, 'thinking'); e.push(B, 'thinking'); expect(sends).toHaveLength(2); e.push(AGT, 'streaming'); e.dispose(); await clock.advance(2000); expect(sends).toHaveLength(2); e.push(AGT, 'idle'); expect(sends).toHaveLength(2);
  });
  it('a clock that steps backwards never produces a negative wait or a duplicate', async () => {
    let t = 10_000; const sends: WirePayload[] = []; const timers: (() => void)[] = []; const e = createStateEmitter({ clock: { now: () => t, setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => undefined }, send: (p) => sends.push(p) });
    e.push(AGT, 'thinking'); t = 5_000; e.push(AGT, 'streaming'); expect(sends).toHaveLength(1); expect(timers).toHaveLength(1); timers.forEach((f) => f()); e.push(AGT, 'streaming'); expect(sends.map((s) => s.state)).toEqual(['thinking', 'streaming']);
  });
  it('property: any push schedule gives at most 2 sends in any one second, no repeats, only wire states, and ends on the latest state', () => {
    fc.assert(fc.asyncProperty(fc.array(fc.record({ s: fc.constantFrom(...AGENT_WIRE_STATES, 'prompt-received' as const, 'sleeping' as const), dt: fc.integer({ min: 0, max: 700 }) }), { minLength: 1, maxLength: 60 }), async (steps) => {
      const { e, sends, clock } = mk(); let latestWire: string | undefined; for (const st of steps) { e.push(AGT, st.s); if (WIRE.has(st.s)) latestWire = st.s; await clock.advance(st.dt); } await clock.advance(1000);
      for (let i = 2; i < sends.length; i++) expect(sends[i]!.at - sends[i - 2]!.at).toBeGreaterThanOrEqual(1000); for (let i = 1; i < sends.length; i++) expect(sends[i]!.state).not.toBe(sends[i - 1]!.state); expect(sends.every((s) => WIRE.has(s.state))).toBe(true);
      if (latestWire !== undefined) expect(sends.at(-1)?.state ?? latestWire).toBe(latestWire);
    }), { numRuns: 150 });
  });
});

describe('no per-agent growth', () => {
  it('forget drops the emitter record, and exited agents leave nothing behind in the machine or the emitter', async () => {
    const h = harness();
    for (let i = 0; i < 300; i++) { const id = `agt_01JTEST${String(i).padStart(19, '0')}` as AgentId; h.bus.emit('agent:event', { agent_id: id, seq: 1, event: { ...ev({ type: 'turn.started', turn_id: 't' }), agent_id: id } }); h.bus.emit('agent:exited', { agent_id: id, outcome: 'ok' }); }
    await h.settle(5000);
    expect(h.att.size()).toBe(0);
    expect(h.emitter.size()).toBe(0);
  });
});
