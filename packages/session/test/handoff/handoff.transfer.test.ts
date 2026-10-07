import { describe, expect, it } from 'vitest';
import { HostActionGate, onHostChanged, requestHandoff, type HandoffProgress } from '../../src/handoff/index.js';
import { fakeSession } from './fake.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
describe('transfer (acceptance 1, 2)', () => {
  it('sends exactly one transfer frame and succeeds only when host_changed names the target', async () => {
    const s = fakeSession(); const progress: HandoffProgress[] = []; const gate = new HostActionGate(); const p = requestHandoff(s, 'ed1', { gate, onProgress: (x) => progress.push(x) }); await tick();
    expect(s.sent).toEqual([{ kind: 'control.transfer_host', body: { p: { to: 'ed1' } } }]); expect(progress).toEqual(['requested', 'accepted']); let settled = false; void p.then(() => { settled = true; }); await tick(); expect(settled).toBe(false);
    s.push({ kind: 'control.host_changed', from: 'srv', p: { host: 'ed1', code: 'transfer' } }); expect(await p).toEqual({ ok: true, newHost: 'ed1' }); expect(progress).toEqual(['requested', 'accepted', 'done']); expect(s.sent).toHaveLength(1);
  });
  it('the old host stops acting at the transfer frame, not at the click', async () => {
    const s = fakeSession(); const gate = new HostActionGate(); expect(gate.allowed()).toBe(true); void requestHandoff(s, 'ed1', { gate }); await tick(); expect(gate.allowed()).toBe(false); expect(gate.allowed(100)).toBe(true); expect(gate.allowed(101)).toBe(false); gate.seen(101); expect(gate.frozen).toBe(true); gate.thaw(); expect(gate.allowed()).toBe(true);
  });
  it('a non-host gets forbidden and sends nothing; a viewer, a non-member or yourself is not_editor; missing keys are refused with the reason', async () => {
    const e = fakeSession({ role: 'editor' }); expect(await requestHandoff(e, 'ed1')).toEqual({ ok: false, code: 'forbidden' }); expect(e.sent).toHaveLength(0);
    const s = fakeSession(); for (const to of ['view1', 'nobody', 'host1']) expect(await requestHandoff(s, to)).toEqual({ ok: false, code: 'not_editor' }); expect(s.sent).toHaveLength(0);
    const k = fakeSession({ members: [{ id: 'host1', role: 'host', connected: true }, { id: 'ed1', role: 'editor', connected: true, missingKeys: true }] }); expect(await requestHandoff(k, 'ed1')).toEqual({ ok: false, code: 'keys_missing' }); expect(k.sent).toHaveLength(0);
  });
  it('times out after 10 s with no host_changed and stays host', async () => {
    const s = fakeSession(); const p = requestHandoff(s, 'ed1'); await tick(); s.clock.advance(9999); let r: unknown; void p.then((x) => { r = x; }); await tick(); expect(r).toBeUndefined(); s.clock.advance(1); expect(await p).toEqual({ ok: false, code: 'timeout' }); expect(s.role()).toBe('host');
  });
  it('a send that is refused resolves forbidden', async () => { const s = fakeSession({ sendError: { code: 'forbidden' } }); expect(await requestHandoff(s, 'ed1')).toEqual({ ok: false, code: 'forbidden' }); });
  it('onHostChanged reports transfers and failovers', () => { const s = fakeSession(); const got: unknown[] = []; const off = onHostChanged(s, (e) => got.push([e.host, e.code])); s.push({ kind: 'control.host_changed', from: 'srv', p: { host: 'a', code: 'transfer' } }); s.push({ kind: 'control.host_changed', from: 'srv', p: { host: 'b', code: 'failover' } }); s.push({ kind: 'reaction', from: 'x' }); off(); s.push({ kind: 'control.host_changed', from: 'srv', p: { host: 'c', code: 'transfer' } }); expect(got).toEqual([['a', 'transfer'], ['b', 'failover']]); });
});

describe('failover (acceptance 4)', () => {
  it('a failover changes the role without touching what the person was typing or the connection', async () => {
    const { watchRole } = await import('../../src/handoff/index.js'); const s = fakeSession({ me: 'ed1', role: 'editor' }); const draft = { text: 'half a prompt' }; const roles: unknown[] = []; let connects = 0; void connects;
    const off = watchRole(s, (e) => roles.push([e.role, e.host, e.code])); s.push({ kind: 'control.host_changed', from: 'srv', p: { host: 'ed1', code: 'failover' } }); s.push({ kind: 'control.host_changed', from: 'srv', p: { host: 'ed2', code: 'transfer' } }); off();
    expect(roles).toEqual([['host', 'ed1', 'failover'], ['editor', 'ed2', 'transfer']]); expect(draft.text).toBe('half a prompt'); expect(s.sent).toHaveLength(0);
  });
});
