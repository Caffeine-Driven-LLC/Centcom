import { describe, expect, it } from 'vitest';
import { requestHandoff } from '../../src/handoff/index.js';
import { fakeSession } from './fake.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
describe('races (acceptance 6)', () => {
  it('two transfers: the one sequenced first wins, the other resolves superseded', async () => {
    const a = fakeSession(); const b = fakeSession(); const pa = requestHandoff(a, 'ed1'); const pb = requestHandoff(b, 'ed2'); await tick();
    const hc = { kind: 'control.host_changed', from: 'srv', p: { host: 'ed1', code: 'transfer' } }; a.push(hc); b.push(hc); expect(await pa).toEqual({ ok: true, newHost: 'ed1' }); expect(await pb).toEqual({ ok: false, code: 'superseded' });
  });
  it('a rival transfer that already took effect makes the refused send superseded', async () => { const s = fakeSession({ sendError: { code: 'forbidden' } }); s.setRole('editor'); /* the other transfer was sequenced first */ const p = requestHandoff(Object.assign(s, { role: () => 'host' as const }), 'ed1'); s.role = () => 'editor'; expect(await p).toEqual({ ok: false, code: 'superseded' }); });
  it('the target is kicked or leaves before the transfer: superseded, the old host stays', async () => {
    const s = fakeSession(); const p = requestHandoff(s, 'ed1'); await tick(); s.push({ kind: 'control.member_left', from: 'srv', p: { member: 'ed1', code: 'kicked' } }); expect(await p).toEqual({ ok: false, code: 'superseded' });
  });
  it('a failover while waiting also ends the request', async () => { const s = fakeSession(); const p = requestHandoff(s, 'ed1'); await tick(); s.push({ kind: 'control.host_changed', from: 'srv', p: { host: 'ed2', code: 'failover' } }); expect(await p).toEqual({ ok: false, code: 'superseded' }); });
});
