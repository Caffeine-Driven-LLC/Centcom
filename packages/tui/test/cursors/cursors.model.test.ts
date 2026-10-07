import { describe, expect, it } from 'vitest';
import { layoutCursors, slotToColour, tagText, cursorsFromPresence } from '../../src/cursors/index.js';
import { cur, mapOf, roster, vp } from './helpers.js';

describe('colours (acceptance 3)', () => {
  it('self is violet; others take red, yellow, green, brown in slot order skipping self; the sixth is an outlined violet', () => {
    expect([0, 1, 2, 3, 4, 5].map((s) => slotToColour(s, 0))).toEqual(['violet', 'red', 'yellow', 'green', 'brown', 'violet-outlined']);
    expect([0, 1, 2, 3, 4, 5].map((s) => slotToColour(s, 2))).toEqual(['red', 'yellow', 'violet', 'green', 'brown', 'violet-outlined']);
  });
});
describe('what is drawn', () => {
  const now = 1000;
  it('never labels your own cursor, ignores unknown members and other files, and shows initial plus name', () => {
    const m = layoutCursors({ cursors: mapOf(cur('me', { updatedAt: now }), cur('ghost', { updatedAt: now }), cur('ada', { updatedAt: now, path: 'src/other.ts' }), cur('cy', { updatedAt: now })), roster, viewport: vp, selfMember: 'me', now });
    expect(m.map((x) => x.member)).toEqual(['cy']); expect(m[0]).toMatchObject({ colour: 'green', tag: 'C Cy', row: 5, col: 4 });
  });
  it('cuts long names at 12 cells with an ellipsis, collapses to the initial under 60 columns, outlines the sixth', () => {
    expect(tagText('Benedikt-Alexander-Long', { cols: 80 })).toBe('B Benedikt-Al…'); expect(tagText('Ada', { cols: 59 })).toBe('A'); expect(tagText('Ed', { cols: 80, outlined: true })).toBe('[E Ed]');
    expect(tagText('Ada', { cols: 80, edge: 'up' })).toBe('↑ A Ada');
  });
  it('a cursor above or below the viewport becomes an edge marker, not an error; markers on one edge do not overlap', () => {
    const m = layoutCursors({ cursors: mapOf(cur('ada', { line: 99, updatedAt: 0 }), cur('cy', { line: 100, updatedAt: 0 }), cur('ben', { line: 1, updatedAt: 0 })), roster, viewport: { ...vp, firstLine: 10 }, selfMember: 'me', now: 0 });
    const down = m.filter((x) => x.edge === 'down'); expect(down).toHaveLength(2); expect(down.every((x) => x.row === 19)).toBe(true); expect(down[1]!.col).toBeGreaterThan(down[0]!.col); expect(m.find((x) => x.member === 'ben')).toMatchObject({ edge: 'up', row: 0 });
  });
  it('selections span lines and clip at the viewport edges', () => {
    const [m] = layoutCursors({ cursors: mapOf(cur('ada', { line: 18, col: 10, selEndLine: 25, selEndCol: 3, updatedAt: 0 })), roster, viewport: { ...vp, firstLine: 10, lines: 10 }, selfMember: 'me', now: 0 })!;
    expect(m!.selection).toEqual([{ row: 8, from: 10, to: 80 }, { row: 9, from: 0, to: 80 }]);
    const [b] = layoutCursors({ cursors: mapOf(cur('ada', { line: 12, col: 5, selEndLine: 12, selEndCol: 9, updatedAt: 0 })), roster, viewport: vp, selfMember: 'me', now: 0 }); expect(b!.selection).toEqual([{ row: 12, from: 5, to: 9 }]);
    const [r] = layoutCursors({ cursors: mapOf(cur('ada', { line: 12, col: 9, selEndLine: 10, selEndCol: 2, updatedAt: 0 })), roster, viewport: vp, selfMember: 'me', now: 0 }); expect(r!.selection.map((s) => s.row)).toEqual([10, 11, 12]);
  });
  it('odd input never throws', () => { expect(() => layoutCursors({ cursors: mapOf(cur('ada', { line: NaN, updatedAt: 0 }), cur('cy', { line: 1e9, col: -5, selEndLine: Infinity, updatedAt: 0 })), roster, viewport: vp, selfMember: 'nobody', now: 0 })).not.toThrow(); });
});
describe('from the presence model', () => {
  it('offline members and members without a cursor are not in it', () => {
    const m = cursorsFromPresence(new Map([['ada', { status: 'online', activity: 'idle', cursor: { path: 'a', line: 1 }, updatedAt: 5 }], ['ben', { status: 'offline', activity: 'idle', cursor: { line: 1 }, updatedAt: 5 }], ['cy', { status: 'online', activity: 'idle', updatedAt: 5 }]] as never));
    expect([...m.keys()]).toEqual(['ada']); expect(m.get('ada')).toEqual({ member: 'ada', path: 'a', line: 1, updatedAt: 5 });
  });
});
