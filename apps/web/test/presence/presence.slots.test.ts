import { describe, expect, it } from 'vitest';
import { INITIAL_ON, STATUS_GLYPH, STATUS_WORD, activityText, rosterLine, roleChip, slotColour } from '../../src/presence/slots.js';

describe('slots to colours (acceptance 5)', () => {
  it('slots 0 to 7, with you at slot 0 and at slot 3', () => { expect([0, 1, 2, 3, 4, 5, 6, 7].map((s) => slotColour(s, 0))).toEqual(['violet', 'red', 'yellow', 'green', 'brown', 'violet-outlined', 'violet-outlined', 'violet-outlined']); expect([0, 1, 2, 3, 4, 5].map((s) => slotColour(s, 3))).toEqual(['red', 'yellow', 'green', 'violet', 'brown', 'violet-outlined']); });
  it('the sixth person is read out with a name and a colour word, not colour alone', () => { expect(rosterLine('Maya', slotColour(3, 0))).toBe('M · Maya · green'); expect(rosterLine('Ed', slotColour(5, 0))).toBe('E · Ed · violet outline'); expect(rosterLine('  ', 'red')).toBe('? ·    · red'); });
  it('white initials on violet and brown, dark on red, yellow and green', () => { expect(INITIAL_ON).toMatchObject({ violet: 'white', brown: 'white', 'violet-outlined': 'white', red: 'ink', yellow: 'ink', green: 'ink' }); });
  it('four statuses, four shapes and four words (acceptance 1)', () => { expect(new Set(Object.values(STATUS_GLYPH)).size).toBe(4); expect(STATUS_GLYPH).toEqual({ online: '✓', away: '◷', offline: '–', busy: '−' }); expect(new Set(Object.values(STATUS_WORD)).size).toBe(4); });
  it('role chips and activity words', () => { expect([roleChip('host'), roleChip('editor'), roleChip('viewer'), roleChip('x')]).toEqual(['HOST', 'EDIT', 'VIEW', 'VIEW']); expect(activityText('typing', 'online', undefined, 0)).toBe('typing'); expect(activityText('reviewing', 'online', undefined, 0)).toBe('reviewing diff'); expect(activityText('idle', 'away', 0, 4 * 60_000 + 5000)).toBe('away 4m'); expect(activityText('idle', 'away', 0, 1000)).toBe('away'); expect(activityText('idle', 'online', undefined, 0)).toBe(''); });
});
