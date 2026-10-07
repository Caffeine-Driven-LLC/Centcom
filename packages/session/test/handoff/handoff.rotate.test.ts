import { describe, expect, it } from 'vitest';
import { EpochTracker, requestHandoff } from '../../src/handoff/index.js';
import { fakeSession } from './fake.js';

describe('rotate_key mid-handoff (acceptance 7)', () => {
  it('after the rotate_key frame every new frame is stamped with the new kid; older frames cannot move it back', async () => {
    const s = fakeSession(); const ep = new EpochTracker(s, 'k1'); const p = requestHandoff(s, 'ed1'); await new Promise((r) => setTimeout(r, 0));
    expect(ep.stamp('k1')).toBe('k1'); s.push({ kind: 'control.rotate_key', from: 'srv', seq: 300, p: { kid: 'k2', reason: 'member_removed' } }); expect(ep.current()).toBe('k2'); expect(ep.stamp('k1')).toBe('k2'); expect(ep.isStale('k1')).toBe(true);
    s.push({ kind: 'control.rotate_key', from: 'srv', seq: 250, p: { kid: 'k0' } }); expect(ep.current()).toBe('k2'); s.push({ kind: 'control.host_changed', from: 'srv', seq: 301, p: { host: 'ed1', code: 'transfer' } }); expect(await p).toEqual({ ok: true, newHost: 'ed1' }); expect(ep.stamp('k1')).toBe('k2'); ep.dispose(); s.push({ kind: 'control.rotate_key', from: 'srv', seq: 400, p: { kid: 'k3' } }); expect(ep.current()).toBe('k2');
  });
});
