import { describe, expect, it } from 'vitest';
import { freshness, layoutCursors } from '../../src/cursors/index.js';
import { cur, mapOf, roster, vp } from './helpers.js';

describe('expiry (acceptance 2)', () => {
  it('live under 3 s, dim from 3.0 s, gone from 10.0 s', () => {
    const at = (ms: number) => layoutCursors({ cursors: mapOf(cur('ada', { updatedAt: 0 })), roster, viewport: vp, selfMember: 'me', now: ms })[0]?.fresh;
    expect(at(2900)).toBe('live'); expect(at(3000)).toBe('dim'); expect(at(9900)).toBe('dim'); expect(at(10_000)).toBeUndefined(); expect(freshness(10_000, 0)).toBe('gone');
  });
  it('a member who left the roster loses the cursor at once, whatever its age', () => {
    expect(layoutCursors({ cursors: mapOf(cur('ada', { updatedAt: 100 })), roster: roster.filter((r) => r.id !== 'ada'), viewport: vp, selfMember: 'me', now: 100 })).toEqual([]);
  });
});
