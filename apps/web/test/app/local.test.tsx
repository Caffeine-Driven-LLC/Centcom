// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { emptyView, engineStatus, pickEngine, reduceLocal } from '../../src/local/model.js';
import { LocalPage } from '../../src/local/routes.js';

afterEach(() => { cleanup(); delete (window as { centcom?: unknown }).centcom; });
const st = (installed: boolean, signedIn: 'yes' | 'no' | 'unknown' = 'yes') => ({ installed, version: '1.0', signedIn, kind: 'subscription' as never });
const launcher = (o: Record<string, unknown> = {}) => ({ t: 'launcher' as const, home: '/h', cwd: '/h/p', recent: [{ dir: '/h/p', at: 1 }], claude: st(true), codex: st(false), prefs: { theme: 'auto' as const, side: true, engine: 'claude-code' as const }, ...o });
describe('local session model', () => {
  it('state messages merge changed items and keep the order', () => {
    let v = reduceLocal(emptyView(), { t: 'opened', dir: '/h/p', history: ['a'] });
    v = reduceLocal(v, { t: 'state', state: { busy: false } as never, changed: [{ kind: 'user', id: 'u1', text: 'hi', ts: 1 }, { kind: 'assistant', id: 'a1', messageId: 'm', agentId: 'x', text: 'he', done: false }], order: ['u1', 'a1'] });
    const u1 = v.items[0]; v = reduceLocal(v, { t: 'state', state: { busy: true } as never, changed: [{ kind: 'assistant', id: 'a1', messageId: 'm', agentId: 'x', text: 'hello', done: true }], order: ['u1', 'a1', 'gone'] });
    expect(v.items.map((i) => i.id)).toEqual(['u1', 'a1']); expect(v.items[0]).toBe(u1); expect((v.items[1] as { text: string }).text).toBe('hello');
    expect(reduceLocal(v, { t: 'closed' }).items).toEqual([]); expect(reduceLocal(v, { t: 'opened', dir: '/x', history: [] }).items).toEqual([]);
  });
  it('notices count up; engine choice follows what is installed', () => {
    expect(reduceLocal(reduceLocal(emptyView(), { t: 'notice', level: 'warn', text: 'a' }), { t: 'notice', level: 'error', text: 'b' }).notice).toMatchObject({ text: 'b', n: 2 });
    expect(pickEngine(launcher({ claude: st(false), codex: st(false) }))).toEqual({ engine: 'claude-code', demo: true }); expect(pickEngine(launcher({ claude: st(false), codex: st(true) }))).toEqual({ engine: 'codex', demo: false }); expect(pickEngine(launcher())).toEqual({ engine: 'claude-code', demo: false });
    expect(engineStatus(launcher(), 'claude-code').ok).toBe(true); expect(engineStatus(launcher({ claude: st(true, 'no') }), 'claude-code').text).toContain('claude auth login'); expect(engineStatus(launcher(), 'codex').text).toContain('not found');
  });
});
describe('the local agent screen', () => {
  it('says so in a browser tab', () => { render(<LocalPage />); expect(screen.getByText('Only in the desktop app')).toBeTruthy(); });
  it('hello, pick a folder, open it, send a message, answer an approval', async () => {
    const sent: { t: string; [k: string]: unknown }[] = []; let push: (m: unknown) => void = () => undefined;
    (window as { centcom?: unknown }).centcom = { desktop: true, local: { send: (m: { t: string }) => sent.push(m), onMessage: (cb: (m: unknown) => void) => { push = cb; return () => undefined; } } };
    render(<LocalPage />); expect(sent[0]).toEqual({ t: 'hello' });
    await act(async () => push(launcher())); expect(sent.at(-1)).toEqual({ t: 'browse', path: '/h/p' });
    await act(async () => push({ t: 'dir', path: '/h/p', parent: '/h', git: true, entries: [{ name: 'src', git: false }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Open ~/p' })); expect(sent.at(-1)).toEqual({ t: 'open', dir: '/h/p', demo: false, engine: 'claude-code' });
    await act(async () => push({ t: 'opened', dir: '/h/p', history: [] }));
    await act(async () => push({ t: 'state', state: { busy: true, verb: 'Thinking', branch: 'main', engineLabel: 'Claude Code', approvals: [{ id: 'ap1', tool: 'Bash', summary: 'ls', risk: 'low', agentName: 'Cento', command: 'ls' }] }, changed: [{ kind: 'assistant', id: 'a', messageId: 'm', agentId: 'x', text: 'working on it', done: false }], order: ['a'] }));
    expect(screen.getByText('working on it')).toBeTruthy(); fireEvent.click(screen.getByText('Deny')); expect(sent.at(-1)).toEqual({ t: 'approve', decision: 'deny' });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'do it' } }); fireEvent.click(screen.getByText('Send')); expect(sent.at(-1)).toEqual({ t: 'submit', text: 'do it' });
  });
});
