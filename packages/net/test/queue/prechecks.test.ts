import { describe, expect, it } from 'vitest';
import { NotAllowedError, QueueFullError, checkSubmit, MEMBER_CAP, DEFAULT_QUEUE_LIMIT } from '../../src/index.js';

const base = { role: 'editor' as const, muted: false, locked: false, paused: false, liveOfMember: 0, liveTotal: 0 };
describe('local submit checks (acceptance 4, 5)', () => {
  it('a viewer, a muted member and a locked session are refused with the reason', () => {
    expect(() => checkSubmit({ ...base, role: 'viewer' })).toThrowError(expect.objectContaining({ reason: 'viewer' })); expect(() => checkSubmit({ ...base, muted: true })).toThrowError(expect.objectContaining({ reason: 'muted' })); expect(() => checkSubmit({ ...base, locked: true })).toThrowError(expect.objectContaining({ reason: 'locked' }));
    expect(() => checkSubmit({ ...base, locked: true, role: 'host' })).not.toThrow(); expect(() => checkSubmit({ ...base, role: 'viewer', muted: true })).toThrowError(NotAllowedError); expect(new NotAllowedError('muted').message).toMatch(/muted/);
  });
  it('the 6th live item of one member and the session limit are blocked', () => {
    expect(MEMBER_CAP).toBe(5); expect(DEFAULT_QUEUE_LIMIT).toBe(20); expect(() => checkSubmit({ ...base, liveOfMember: 4 })).not.toThrow(); expect(() => checkSubmit({ ...base, liveOfMember: 5 })).toThrowError(QueueFullError); expect(() => checkSubmit({ ...base, liveTotal: 19 })).not.toThrow(); expect(() => checkSubmit({ ...base, liveTotal: 20 })).toThrowError(QueueFullError);
    expect(() => checkSubmit({ ...base, liveTotal: 7, queueLimit: 7 })).toThrowError(QueueFullError); expect(() => checkSubmit({ ...base, liveTotal: 25, queueLimit: 30 })).not.toThrow();
  });
  it('a full matrix: the first matching rule decides', () => {
    for (const role of ['host', 'editor', 'viewer'] as const) for (const muted of [false, true]) for (const locked of [false, true]) for (const liveOfMember of [0, 5]) {
      const expectName = role === 'viewer' ? 'viewer' : muted ? 'muted' : locked && role !== 'host' ? 'locked' : liveOfMember >= 5 ? 'full' : 'ok'; let got = 'ok'; try { checkSubmit({ ...base, role, muted, locked, liveOfMember }); } catch (e) { got = e instanceof NotAllowedError ? e.reason : e instanceof QueueFullError ? 'full' : 'other'; } expect(got, JSON.stringify({ role, muted, locked, liveOfMember })).toBe(expectName);
    }
  });
});
