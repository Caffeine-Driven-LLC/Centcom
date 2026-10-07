import { describe, expect, it } from 'vitest';
import { priorityOf as tuiPriority, knownState } from '../../../../packages/tui/src/mascot/priority.js';
import { STATE_NAMES } from '@centcom/states';
import { allTiered, glyphFor, priorityOf } from '../../shell/src/fleet/priority.js';
import { sortCards } from '../../shell/src/fleet/model.js';
import { members, spawn, state, store } from './helpers.js';

describe('priority (DESIGN.md 11.2)', () => {
  it('is the same table the terminal uses, for every state it knows', () => { for (const s of STATE_NAMES) expect(priorityOf(s), s).toBe(tuiPriority(s)); expect(allTiered().sort()).toEqual(STATE_NAMES.filter((s) => knownState(s)).sort()); });
  it('errors first, then approvals, questions and conflicts, then limits, work, ci, background, social, idle; unknown is ordinary work', () => { expect(['error', 'awaiting-approval', 'merge-conflict', 'rate-limited', 'editing-file', 'ci-pass', 'saving', 'teammate-joins', 'idle'].map(priorityOf)).toEqual([1, 2, 2, 3, 4, 5, 6, 7, 8]); expect(priorityOf('state-from-the-future')).toBe(4); });
  it('every state has a glyph, and approval, error and running are different from each other', () => { for (const s of STATE_NAMES) expect(glyphFor(s).length, s).toBeGreaterThan(0); expect(new Set([glyphFor('awaiting-approval'), glyphFor('error'), glyphFor('editing-file'), glyphFor('idle')]).size).toBe(4); expect(glyphFor('idle', true)).toBe('■'); });
});
describe('order (acceptance 2)', () => {
  it('the card that needs a person moves to the front within one change, then mine before others, then the longest wait', () => {
    const s = store(); for (const [id, owner] of [['a', 'mem_b'], ['b', 'mem_me'], ['c', 'mem_c'], ['d', 'mem_me']] as const) spawn(s, id, owner); state(s, 'a', 'idle', 'mem_b'); state(s, 'b', 'editing-file', 'mem_me'); state(s, 'c', 'thinking', 'mem_c'); state(s, 'd', 'editing-file', 'mem_me', Date.UTC(2026, 9, 7, 11)); expect(s.cards().map((c) => c.agentId)).toEqual(['d', 'b', 'c', 'a']);
    state(s, 'c', 'awaiting-approval', 'mem_c'); expect(s.cards()[0]!.agentId).toBe('c'); state(s, 'b', 'awaiting-approval', 'mem_me', Date.UTC(2026, 9, 7, 12, 5)); expect(s.cards().slice(0, 2).map((c) => c.agentId)).toEqual(['b', 'c']); expect(s.cards()[0]!.needsYou).toBe(true); expect(s.cards()[1]!.needsYou).toBe(false);
  });
  it('filters by owner and by state', () => { const s = store(9); expect(s.cards({ owner: 'mem_b' }).every((c) => c.owner === 'mem_b')).toBe(true); expect(s.cards({ state: 'awaiting-approval' }).every((c) => c.state === 'awaiting-approval')).toBe(true); expect(s.cards({ owner: 'mem_b', state: 'nonsense' })).toEqual([]); void members; });
  it('sortCards is stable for equal cards', () => { const s = store(6); const a = sortCards(s.cards()).map((c) => c.agentId); expect(sortCards(s.cards().reverse()).map((c) => c.agentId)).toEqual(a); });
});
