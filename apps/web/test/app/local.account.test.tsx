// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { AccountChip } from '../../src/local/Account.js';
import { LocalProvider } from '../../src/local/use-local.js';

afterEach(() => { cleanup(); delete (window as { centcom?: unknown }).centcom; });
async function mount(): Promise<{ sent: { t: string }[]; push(m: unknown): Promise<void> }> {
  const sent: { t: string }[] = []; let cb: (m: unknown) => void = () => undefined;
  const bridge = { send: (m: { t: string }) => sent.push(m), onMessage: (f: (m: unknown) => void) => { cb = f; return () => undefined; } };
  const root = createRootRoute({ component: () => <LocalProvider bridge={bridge}><AccountChip /></LocalProvider> });
  const router = createRouter({ routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: '/local', component: () => null })]), history: createMemoryHistory({ initialEntries: ['/'] }) });
  await act(async () => { render(<RouterProvider router={router} />); }); await waitFor(() => expect(sent.some((m) => m.t === 'hello')).toBe(true));
  return { sent, push: async (m) => { await act(async () => cb(m)); } };
}
const out = { t: 'account' as const, account: { signedIn: false, persisted: true, api: 'http://localhost:3000' } };
const inn = { t: 'account' as const, account: { signedIn: true, persisted: true, api: 'http://localhost:3000', me: { id: 'u', name: 'Alice Example', email: 'alice@example.test', plan: 'team' } } };

describe('the account button', () => {
  it('asks who is signed in once the app is there, and offers sign-in with a browser code', async () => {
    const { sent, push } = await mount(); await push({ t: 'launcher', home: '/h', cwd: '/h', recent: [], claude: { installed: true, signedIn: 'yes' }, codex: { installed: false, signedIn: 'unknown' }, prefs: { theme: 'auto', side: true, engine: 'claude-code' } });
    expect(sent.some((m) => m.t === 'account')).toBe(true); await push(out);
    fireEvent.click(screen.getByRole('button', { name: /Sign in/ })); fireEvent.click(screen.getByRole('button', { name: 'Sign in with your browser' })); expect(sent.at(-1)).toEqual({ t: 'login' });
    await push({ t: 'login', phase: 'code', userCode: 'ABCD-EFGH', url: 'http://localhost:3000/device?user_code=ABCD-EFGH', expiresInS: 900, opened: true });
    expect(screen.getByLabelText('Sign-in code').textContent).toBe('ABCD-EFGH'); expect(screen.getByText(/browser is open/)).toBeTruthy();
    await push(inn); await push({ t: 'login', phase: 'done' }); expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByText('Alice Example')).toBeTruthy(); expect(screen.getByText('team')).toBeTruthy();
  });
  it('shows a failed sign-in, and who is signed in with a sign-out', async () => {
    const { sent, push } = await mount(); await push({ t: 'launcher', home: '/h', cwd: '/h', recent: [], claude: { installed: true, signedIn: 'yes' }, codex: { installed: false, signedIn: 'unknown' }, prefs: { theme: 'auto', side: true, engine: 'claude-code' } });
    await push(out); fireEvent.click(screen.getByRole('button', { name: /Sign in/ })); await push({ t: 'login', phase: 'failed', error: 'The sign-in was declined in the browser.' }); expect(screen.getByRole('alert').textContent).toMatch(/declined/);
    await push(inn); fireEvent.click(screen.getByRole('button', { name: /Alice Example/ })); expect(screen.getByText('alice@example.test')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Sign out' })); expect(sent.at(-1)).toEqual({ t: 'logout' });
  });
});

describe('the Team panel', () => {
  const launcher = { t: 'launcher', home: '/h', cwd: '/h', recent: [], claude: { installed: true, signedIn: 'yes' }, codex: { installed: false, signedIn: 'unknown' }, prefs: { theme: 'auto', side: true, engine: 'claude-code' } };
  const team = { workspace: { id: 'wsp_1', name: 'Acme' }, plan: 'free', status: 'active', seats: { used: 2, max: 3 }, relayAccess: false, myRole: 'owner', canManage: true,
    members: [{ id: 'mem_1', name: 'Alice Example', email: 'alice@example.test', role: 'owner', you: true }, { id: 'mem_2', name: 'Bob', role: 'member', you: false }], invites: [{ id: 'inv_1', email: 'c@x.test', role: 'guest', expiresAt: '2026-10-20T00:00:00Z' }] };
  async function open() {
    const m = await mount(); await m.push(launcher); await m.push(inn); fireEvent.click(screen.getByRole('button', { name: /Alice Example/ })); fireEvent.click(screen.getByRole('button', { name: /Team/ })); return m;
  }
  it('asks for the team, lists people, plan and seats, and offers Upgrade when the plan has no relay', async () => {
    const { sent, push } = await open(); expect(sent.at(-1)).toEqual({ t: 'team' }); await push({ t: 'team', team });
    expect(screen.getByText('Acme')).toBeTruthy(); expect(screen.getByText(/2 of 3 seats used/)).toBeTruthy(); expect(screen.getByText('Bob')).toBeTruthy(); expect(screen.getByText('c@x.test')).toBeTruthy(); expect(screen.getByText(/The person who hosts pays/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Upgrade/ })); expect(sent.at(-1)).toEqual({ t: 'upgrade' });
  });
  it('invites with a role, changes a role, removes a member and revokes an invite', async () => {
    const { sent, push } = await open(); await push({ t: 'team', team });
    fireEvent.change(screen.getByLabelText('E-mail address'), { target: { value: 'new@x.test' } }); fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'admin' } }); fireEvent.click(screen.getByRole('button', { name: 'Invite' })); expect(sent.at(-1)).toEqual({ t: 'teamInvite', email: 'new@x.test', role: 'admin' });
    await push({ t: 'team', team, done: 'Invited new@x.test as admin.', link: 'https://centcom.dev/i/T' }); expect(screen.getByRole('status').textContent).toContain('https://centcom.dev/i/T');
    fireEvent.change(screen.getByLabelText('Role of Bob'), { target: { value: 'billing' } }); expect(sent.at(-1)).toEqual({ t: 'teamRole', member: 'mem_2', role: 'billing' });
    await push({ t: 'team', team }); fireEvent.click(screen.getByRole('button', { name: 'Remove Bob' })); expect(sent.at(-1)).toEqual({ t: 'teamRemove', member: 'mem_2' });
    await push({ t: 'team', team }); fireEvent.click(screen.getByRole('button', { name: 'Revoke' })); expect(sent.at(-1)).toEqual({ t: 'teamRevoke', invite: 'inv_1' });
  });
  it('a plain member sees the people but no controls, and an error is shown', async () => {
    const { push } = await open(); await push({ t: 'team', team: { ...team, canManage: false, relayAccess: true }, error: 'Only an owner or admin can do this.' });
    expect(screen.queryByLabelText('E-mail address')).toBeNull(); expect(screen.queryByLabelText('Role of Bob')).toBeNull(); expect(screen.queryByRole('button', { name: /Upgrade/ })).toBeNull(); expect(screen.getByRole('alert').textContent).toMatch(/owner or admin/);
  });
});
