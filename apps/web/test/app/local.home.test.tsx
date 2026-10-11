// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { LocalPage } from '../../src/local/routes.js';
import { attention, notificationFor, titleFor } from '../../src/local/attention.js';

afterEach(() => { cleanup(); delete (window as { centcom?: unknown }).centcom; });
const st = { installed: true, version: '1.0', signedIn: 'yes' as const, kind: 'subscription' as never };
const launcher = { t: 'launcher' as const, home: '/h', cwd: '/h/p', recent: [{ dir: '/h/p', at: 1 }, { dir: '/h/q', at: 0 }], claude: st, codex: { ...st, installed: false }, prefs: { theme: 'auto' as const, side: true, engine: 'claude-code' as const } };

describe('start with a task', () => {
  it('opens the chosen project and sends the task once it has a state', async () => {
    const sent: { t: string; [k: string]: unknown }[] = []; let push: (m: unknown) => void = () => undefined;
    (window as { centcom?: unknown }).centcom = { desktop: true, local: { send: (m: { t: string }) => sent.push(m), onMessage: (cb: (m: unknown) => void) => { push = cb; return () => undefined; } } };
    render(<LocalPage />); await act(async () => push(launcher));
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '/h/q' } });
    fireEvent.change(screen.getByLabelText('What should the agent do?'), { target: { value: 'fix the build' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(sent.at(-1)).toEqual({ t: 'open', dir: '/h/q', demo: false, engine: 'claude-code' });
    expect(sent.some((m) => m.t === 'submit')).toBe(false);
    await act(async () => push({ t: 'opened', dir: '/h/q', history: [] }));
    expect(sent.some((m) => m.t === 'submit')).toBe(false);
    await act(async () => push({ t: 'state', state: { busy: false, approvals: [], agents: [], tasks: [], limits: [], sessions: [] }, changed: [], order: [] }));
    expect(sent.filter((m) => m.t === 'submit')).toEqual([{ t: 'submit', text: 'fix the build' }]);
  });
  it('does not start without a task', async () => {
    let push: (m: unknown) => void = () => undefined;
    (window as { centcom?: unknown }).centcom = { desktop: true, local: { send: () => undefined, onMessage: (cb: (m: unknown) => void) => { push = cb; return () => undefined; } } };
    render(<LocalPage />); await act(async () => push(launcher));
    expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
describe('the window title', () => {
  it('says when the agent needs you or works', () => {
    expect(titleFor({ waiting: 0, busy: false })).toBe('Centcom');
    expect(titleFor({ opened: '/h/p/', waiting: 0, busy: false })).toBe('p · Centcom');
    expect(titleFor({ opened: '/h/p', waiting: 0, busy: true })).toBe('Working · p · Centcom');
    expect(titleFor({ opened: '/h/p', waiting: 2, busy: true })).toBe('(2) Needs you · p · Centcom');
  });
});
describe('the approval notice', () => {
  it('fires only for a new approval while the window is in the background', () => {
    expect(notificationFor({ before: 0, now: 1, hidden: true, opened: '/h/p', summary: 'run ls' })).toEqual({ title: 'Needs you · p', body: 'Cento wants to: run ls' });
    expect(notificationFor({ before: 0, now: 1, hidden: false })).toBeNull(); expect(notificationFor({ before: 1, now: 1, hidden: true })).toBeNull(); expect(notificationFor({ before: 2, now: 1, hidden: true })).toBeNull();
    expect(notificationFor({ before: 0, now: 1, hidden: true })?.body).toBe('Cento is waiting for your decision.');
  });
});
describe('attention across sessions', () => {
  const run = (dir: string, waiting: number, busy = false, ask?: string) => ({ dir, waiting, busy, ...(ask ? { ask } : {}) });
  it('adds up what waits in the sessions that are not shown and says which one asked', () => {
    const view = { opened: '/h/p', state: { approvals: [], busy: false }, running: [run('/h/p', 0), run('/h/q', 2, true, 'run ls')] };
    expect(attention(view)).toEqual({ waiting: 2, busy: true, dir: '/h/q', ask: 'run ls' });
  });
  it('counts the shown session from its own state, not from the list', () => {
    const view = { opened: '/h/p', state: { approvals: [{ summary: 'edit a' }], busy: true }, running: [run('/h/p', 0)] };
    expect(attention(view)).toEqual({ waiting: 1, busy: true, dir: '/h/p', ask: 'edit a' });
  });
  it('is quiet when nothing runs', () => { expect(attention({ running: [], state: undefined })).toEqual({ waiting: 0, busy: false, dir: undefined, ask: undefined }); });
});
describe('the rail order', () => {
  it('puts working areas first, account areas last, and drops the duplicate local link inside the desktop app', async () => {
    const { orderNav } = await import('../../src/app/Frame.js');
    const n = (id: string) => ({ id, labelKey: id, to: `/${id}`, icon: 'x' });
    const all = ['billing', 'home', 'local', 'settings', 'workspaces', 'zzz', 'aaa'].map(n);
    expect(orderNav(all, false).map((x) => x.id)).toEqual(['home', 'local', 'workspaces', 'billing', 'settings', 'aaa', 'zzz']);
    expect(orderNav(all, true).map((x) => x.id)).toEqual(['home', 'workspaces', 'billing', 'settings', 'aaa', 'zzz']);
  });
});
describe('the session panel switch', () => {
  it('starts as the saved setting says and saves a change', async () => {
    const sent: { t: string; [k: string]: unknown }[] = []; let push: (m: unknown) => void = () => undefined;
    (window as { centcom?: unknown }).centcom = { desktop: true, local: { send: (m: { t: string }) => sent.push(m), onMessage: (cb: (m: unknown) => void) => { push = cb; return () => undefined; } } };
    render(<LocalPage />); await act(async () => push({ ...launcher, prefs: { ...launcher.prefs, side: false } }));
    await act(async () => push({ t: 'opened', dir: '/h/p', history: [] }));
    await act(async () => push({ t: 'state', state: { busy: false, approvals: [], agents: [], tasks: [], limits: [], sessions: [], settings: {} }, changed: [], order: [] }));
    expect(screen.queryByLabelText('Session details', { selector: 'aside' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Session details' })); expect(sent.at(-1)).toEqual({ t: 'pref', side: true }); expect(screen.getByLabelText('Session details', { selector: 'aside' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Session details' })); expect(sent.at(-1)).toEqual({ t: 'pref', side: false });
  });
});
describe('Enter sends', () => {
  it('Enter sends the message, Shift+Enter does not, and the home task starts on Enter', async () => {
    const sent: { t: string; [k: string]: unknown }[] = []; let push: (m: unknown) => void = () => undefined;
    (window as { centcom?: unknown }).centcom = { desktop: true, local: { send: (m: { t: string }) => sent.push(m), onMessage: (cb: (m: unknown) => void) => { push = cb; return () => undefined; } } };
    render(<LocalPage />); await act(async () => push(launcher));
    fireEvent.change(screen.getByLabelText('What should the agent do?'), { target: { value: 'fix it' } });
    fireEvent.keyDown(screen.getByLabelText('What should the agent do?'), { key: 'Enter', shiftKey: true }); expect(sent.some((m) => m.t === 'open')).toBe(false);
    fireEvent.keyDown(screen.getByLabelText('What should the agent do?'), { key: 'Enter' }); expect(sent.at(-1)).toMatchObject({ t: 'open', dir: '/h/p' });
    await act(async () => push({ t: 'opened', dir: '/h/p', history: [] }));
    await act(async () => push({ t: 'state', state: { busy: false, approvals: [], agents: [], tasks: [], limits: [], sessions: [], settings: {} }, changed: [], order: [] }));
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'next' } });
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter', shiftKey: true }); expect(sent.filter((m) => m.text === 'next')).toEqual([]);
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' }); expect(sent.at(-1)).toEqual({ t: 'submit', text: 'next' });
  });
});
