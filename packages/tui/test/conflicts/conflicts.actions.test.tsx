import React from 'react';
import { CentcomError } from '@centcom/net';
import { describe, expect, it, vi } from 'vitest';
import { renderInk } from '../../../testkit/src/index.js';
import { ConflictBanner, type ConflictView } from '../../src/conflicts/index.js';

const c: ConflictView = { id: 'c1', agents: ['a1', 'a2'], pathHmacs: ['ab12'.repeat(10)], displayPaths: ['src/app.ts'], at: '', seq: 1 };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
describe('actions (acceptance 6)', () => {
  it('w, t and b each call the callback once with their action', async () => {
    for (const [key, action] of [['w', 'wait'], ['t', 'take-turns'], ['b', 'branch-off']] as const) { const fn = vi.fn(); const r = await renderInk(<ConflictBanner conflict={c} onResolve={fn} />); r.stdin.write(key); await tick(); expect(fn).toHaveBeenCalledTimes(1); expect(fn).toHaveBeenCalledWith(action); r.unmount(); }
  });
  it('a double press while the first is pending is ignored, and the buttons say why they are off', async () => {
    let done!: () => void; const fn = vi.fn(() => new Promise<void>((res) => { done = res; })); const r = await renderInk(<ConflictBanner conflict={c} onResolve={fn} />); r.stdin.write('w'); await tick(); r.stdin.write('w'); r.stdin.write('t'); await tick(); expect(fn).toHaveBeenCalledTimes(1); expect(r.screen().join('\n')).toContain('Another action is running.'); done(); await tick(); r.stdin.write('t'); await tick(); expect(fn).toHaveBeenCalledTimes(2); r.unmount();
  });
  it('resolve with Cento asks in plain text first; y confirms once, n cancels, nothing else counts', async () => {
    const fn = vi.fn(); const r = await renderInk(<ConflictBanner conflict={c} onResolve={fn} />); r.stdin.write('r'); await tick(); const text = r.screen().join('\n'); expect(text).toContain('Press y to confirm, n to cancel.'); expect(text).not.toMatch(/[▀▄█]/); expect(fn).not.toHaveBeenCalled(); r.stdin.write('x'); await tick(); expect(fn).not.toHaveBeenCalled(); r.stdin.write('n'); await tick(); expect(r.screen().join('\n')).toContain('r Resolve with Cento');
    r.stdin.write('r'); await tick(); r.stdin.write('y'); await tick(); r.stdin.write('y'); await tick(); expect(fn).toHaveBeenCalledTimes(1); expect(fn).toHaveBeenCalledWith('resolve-with-cento'); r.unmount();
  });
  it('a rejected promise shows a danger toast with the error text and the banner stays', async () => {
    const toast = vi.fn(); const r = await renderInk(<ConflictBanner conflict={c} onResolve={() => Promise.reject(new CentcomError({ kind: 'api', code: 'forbidden', status: 403 }))} toast={toast} />); r.stdin.write('b'); await tick(50); expect(toast).toHaveBeenCalledTimes(1); expect(toast.mock.calls[0]![0]).toMatchObject({ level: 'error' }); expect(toast.mock.calls[0]![0].text).toMatch(/^Could not do that: .+/); expect(r.screen().join('\n')).toContain('! conflict in'); r.stdin.write('w'); await tick(); r.unmount();
    const plain = vi.fn(); const q = await renderInk(<ConflictBanner conflict={c} onResolve={() => { throw new Error('boom'); }} toast={plain} />); q.stdin.write('w'); await tick(50); expect(plain.mock.calls[0]![0].text).toBe('Could not do that: boom'); q.unmount();
  });
  it('an inactive banner ignores the keys', async () => { const fn = vi.fn(); const r = await renderInk(<ConflictBanner conflict={c} onResolve={fn} active={false} />); r.stdin.write('w'); await tick(); expect(fn).not.toHaveBeenCalled(); r.unmount(); });
});
