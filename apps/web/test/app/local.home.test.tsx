// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { LocalPage } from '../../src/local/routes.js';
import { notificationFor, titleFor } from '../../src/local/attention.js';

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
