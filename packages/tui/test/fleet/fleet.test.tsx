import { readFileSync } from 'node:fs';
import React from 'react';
import fc from 'fast-check';
import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { FleetPanel, STATE_LABELS, agentRow, emptyFleet, modeFor, priorityTier, reduceFleet, sortFleet, stateLabel, stateWord, type FleetAgent, type FleetEvent } from '../../src/fleet/index.js';
import { textWidth, type Line } from '../../src/util/text.js';

const text = (l: Line) => l.map((s) => s.t).join(''); const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
const t0 = Date.UTC(2026, 9, 6, 12);
const agent = (o: Partial<FleetAgent> = {}): FleetAgent => ({ agentId: 'agt_01JTEST0000000000000000001', label: 'refactor', ownerMemberId: 'm1', ownerName: 'Maya', ownerSlot: 1, branch: 'agent/refactor', state: 'idle', since: new Date(t0 - 65_000).toISOString(), mode: 'branch', needsMe: false, ...o });

describe('order and tiers', () => {
  it('error, awaiting-approval, merge-conflict, editing-file, thinking, idle', () => {
    const a = ['idle', 'editing-file', 'awaiting-approval', 'error', 'thinking', 'merge-conflict'].map((s, i) => agent({ agentId: `a${i}`, state: s, since: new Date(t0 + i * 1000).toISOString() })); expect(sortFleet(a).map((x) => x.state)).toEqual(['error', 'awaiting-approval', 'merge-conflict', 'editing-file', 'thinking', 'idle']);
  });
  it('within a tier: needs you first, then the longest waiting', () => {
    const a = [agent({ agentId: 'late', state: 'awaiting-approval', since: new Date(t0).toISOString() }), agent({ agentId: 'mine', state: 'awaiting-approval', needsMe: true, since: new Date(t0 + 5000).toISOString() }), agent({ agentId: 'early', state: 'awaiting-approval', since: new Date(t0 - 5000).toISOString() })];
    expect(sortFleet(a).map((x) => x.agentId)).toEqual(['mine', 'early', 'late']);
  });
  it('every one of the 64 states of the state map has a label and exactly one tier', () => {
    const names = Object.keys(JSON.parse(readFileSync(new URL('../../../../contracts/state-map.json', import.meta.url), 'utf8'))); expect(names.length).toBeGreaterThanOrEqual(60);
    for (const n of names) { expect(STATE_LABELS[n], n).toBeDefined(); expect([1, 2, 3, 4, 5, 6, 7, 8]).toContain(priorityTier(n)); expect(STATE_LABELS[n]!.word.length).toBeGreaterThan(0); } expect(Object.keys(STATE_LABELS).sort()).toEqual([...names].sort());
    expect(priorityTier('crash')).toBe(1); expect(priorityTier('awaiting-approval')).toBe(2); expect(priorityTier('rate-limited')).toBe(3); expect(priorityTier('editing-file')).toBe(4); expect(priorityTier('ci-pass')).toBe(5); expect(priorityTier('compacting')).toBe(6); expect(priorityTier('host-session')).toBe(7); expect(priorityTier('sleeping')).toBe(8);
  });
  it('an unknown state reads "working" and is noted once', () => { const log: string[] = []; expect(stateLabel('from-the-future', (m) => log.push(m)).word).toBe('working'); stateLabel('from-the-future', (m) => log.push(m)); expect(log).toEqual(['fleet.unknown_state']); });
});

describe('rows', () => {
  const row = (a: FleetAgent, width: number, active = false) => agentRow(a, { width, selfMemberId: 'm0', now: t0, active });
  it('a rail row has dot, name and the state word; a wide row has name, owner, branch, state and elapsed', () => {
    expect(text(row(agent({ state: 'editing-file' }), 28))).toBe('● refactor ● editing'); expect(text(row(agent({ state: 'editing-file' }), 90))).toBe('● refactor · M · Maya · agent/refactor · ● editing · 1m 05s');
    expect(text(row(agent({ ownerMemberId: 'm0', ownerName: 'Me' }), 90))).toContain('· you ·');
  });
  it('property: no row is wider than the panel (widths 28 to 120)', () => { fc.assert(fc.property(fc.integer({ min: 28, max: 120 }), fc.string({ maxLength: 50 }), fc.constantFrom('idle', 'awaiting-approval', 'editing-file', 'merge-conflict'), (w, name, state) => { expect(textWidth(text(row(agent({ label: name || 'x', state, needsMe: true, branch: name + name }), w)))).toBeLessThanOrEqual(w); }), { numRuns: 200 }); });
  it('your approval says "needs you", someone else\'s says "waiting"; words carry the state without colour; the active row is reverse video', () => {
    expect(stateWord(agent({ state: 'awaiting-approval', needsMe: true })).word).toBe('needs you'); expect(stateWord(agent({ state: 'awaiting-approval', needsMe: false })).word).toBe('waiting');
    const on = row(agent({ state: 'error' }), 60, true); expect(on.every((s) => s.r)).toBe(true); expect(row(agent({ state: 'error' }), 60).some((s) => s.r)).toBe(false); expect(text(on)).toContain('✗ error');
  });
  it('an exit: ok shows done, error shows the code', () => { expect(stateWord(agent({ exit: { outcome: 'ok' } })).word).toBe('done'); expect(stateWord(agent({ exit: { outcome: 'error', errorCode: 'E42' } })).word).toBe('error E42'); expect(stateWord(agent({ exit: { outcome: 'error' } })).word).toBe('error'); });
  it('rail at 100+ columns, overlay below', () => { expect([modeFor(99), modeFor(100)]).toEqual(['overlay', 'rail']); });
});

describe('reducer', () => {
  it('builds rows from spawn, state, exit and branch events; unchanged states give the same object', () => {
    const ev: FleetEvent[] = [{ k: 'agent.spawn', agentId: 'a1', label: 'one', ownerMemberId: 'm1', ownerName: 'Maya', ownerSlot: 2 }, { k: 'agent.state', agentId: 'a1', state: 'thinking', since: new Date(t0).toISOString() }, { k: 'branch.update', agentId: 'a1', branch: 'agent/one' }];
    let s = emptyFleet(); for (const e of ev) s = reduceFleet(s, e); expect(s.agents.a1).toMatchObject({ state: 'thinking', branch: 'agent/one', label: 'one', ownerSlot: 2 });
    const same = reduceFleet(s, { k: 'agent.state', agentId: 'a1', state: 'thinking', since: new Date(t0 + 1).toISOString() }); expect(same).toBe(s); expect(reduceFleet(s, { k: 'agent.state', agentId: 'nope', state: 'idle', since: 'x' })).toBe(s);
    const done = reduceFleet(s, { k: 'agent.exit', agentId: 'a1', outcome: 'ok' }); expect(stateWord(done.agents.a1!).word).toBe('done'); expect(priorityTier(done.agents.a1!.state)).toBe(8); expect(reduceFleet(done, { k: 'agent.state', agentId: 'a1', state: 'thinking', since: 'x' })).toBe(done);
    expect(stateWord(reduceFleet(s, { k: 'agent.exit', agentId: 'a1', outcome: 'error', errorCode: 'X1' }).agents.a1!).word).toBe('error X1');
  });
});

describe('panel', () => {
  it('renders rows in order; the rail is 28 wide; nothing exceeds the width', () => {
    const a = [agent({ agentId: 'a', state: 'idle', label: 'calm' }), agent({ agentId: 'b', state: 'error', label: 'broken' })]; const out = strip(renderToString(<FleetPanel agents={a} selfMemberId="m0" mode="rail" onSelect={() => undefined} now={() => new Date(t0)} />, { columns: 40 })).split('\n').filter(Boolean);
    expect(out[0]).toContain('broken'); expect(out[1]).toContain('calm'); expect(Math.max(...out.map(textWidth))).toBeLessThanOrEqual(28); expect(strip(renderToString(<FleetPanel agents={[]} selfMemberId="m0" mode="overlay" onSelect={() => undefined} />, { columns: 60 }))).toContain('No agents yet.');
  });
});
