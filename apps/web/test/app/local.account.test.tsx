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
