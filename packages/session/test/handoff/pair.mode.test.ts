import { describe, expect, it } from 'vitest';
import { PAIR_STATE, mergeSelections, startPair, type Selection } from '../../src/handoff/index.js';
import { fakeSession } from './fake.js';

const sel = (line: number, col: number, el: number, ec: number, path = 'a.ts'): Selection => ({ path, line, col, selEndLine: el, selEndCol: ec });
const cursor = (from: string, s: Selection) => ({ kind: 'presence.cursor', from, secret: { path: s.path, line: s.line, col: s.col, sel_end_line: s.selEndLine, sel_end_col: s.selEndCol } });
describe('merge', () => {
  it('the union of two selections on one file, whichever way each was dragged; different files do not merge', () => {
    expect(mergeSelections(sel(2, 4, 5, 1), sel(4, 0, 8, 3))).toEqual(sel(2, 4, 8, 3)); expect(mergeSelections(sel(5, 1, 2, 4), sel(8, 3, 4, 0))).toEqual(sel(2, 4, 8, 3)); expect(mergeSelections(sel(1, 0, 1, 5), sel(1, 3, 1, 9))).toEqual(sel(1, 0, 1, 9)); expect(mergeSelections(sel(1, 0, 2, 0), sel(1, 0, 2, 0, 'b.ts'))).toBeUndefined();
  });
});
describe('pair mode (acceptance 5)', () => {
  it('announces pair-working, shares one merged selection with the partner, and stop restores independent cursors at once', () => {
    const s = fakeSession({ me: 'ed1', role: 'editor' }); const published: (Selection | null)[] = []; const h = startPair(s, 'agt_1', 'ed2', { publishCursor: (x) => published.push(x) }); expect(s.sent[0]).toMatchObject({ kind: 'agent.state', body: { p: { agent_id: 'agt_1', state: PAIR_STATE } } });
    const seen: (Selection | null)[] = []; h.sharedSelection$.subscribe((v) => seen.push(v)); expect(seen).toEqual([null]); h.setLocal(sel(2, 0, 4, 0)); expect(seen.at(-1)).toBeNull(); s.push(cursor('ed2', sel(3, 0, 9, 2))); expect(seen.at(-1)).toEqual(sel(2, 0, 9, 2));
    s.push(cursor('stranger', sel(100, 0, 101, 0))); expect(seen.at(-1)).toEqual(sel(2, 0, 9, 2)); h.setLocal(sel(1, 0, 1, 1)); expect(seen.at(-1)).toEqual(sel(1, 0, 9, 2));
    const t0 = s.clock.now(); h.stop(); expect(h.active).toBe(false); expect(seen.at(-1)).toBeNull(); expect(published.at(-1)).toEqual(sel(1, 0, 1, 1)); expect(s.clock.now() - t0).toBeLessThanOrEqual(500); expect(s.sent.at(-1)).toMatchObject({ body: { p: { state: 'idle' } } }); s.push(cursor('ed2', sel(5, 0, 6, 0))); expect(seen.at(-1)).toBeNull(); h.stop();
  });
  it('the partner stopping or leaving ends the shared selection; a failing send does not break pairing', () => {
    const s = fakeSession({ me: 'ed1', role: 'editor', sendError: { code: 'forbidden' } }); const h = startPair(s, 'agt_1', 'ed2'); const seen: (Selection | null)[] = []; h.sharedSelection$.subscribe((v) => seen.push(v)); h.setLocal(sel(1, 0, 2, 0)); s.push(cursor('ed2', sel(2, 0, 3, 0))); expect(seen.at(-1)).not.toBeNull();
    s.push({ kind: 'agent.state', from: 'ed2', p: { agent_id: 'agt_1', state: 'idle' } }); expect(seen.at(-1)).toBeNull(); s.push(cursor('ed2', sel(2, 0, 3, 0))); expect(seen.at(-1)).not.toBeNull(); s.push({ kind: 'control.member_left', from: 'srv', p: { member: 'ed2' } }); expect(seen.at(-1)).toBeNull(); h.stop();
  });
});
