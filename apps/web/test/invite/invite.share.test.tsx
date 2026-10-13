// @vitest-environment jsdom
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRouter } from '../../src/app/router.js';
import { reset, setState } from '../../src/auth/store.js';
import { takeShareFragment } from '../../src/invite/fragment.js';
import { routeModule } from '../../src/invite/routes.js';
import { HttpProvider } from '../../src/lib/http-context.js';
import { setSessionLoader } from '../../src/session/lazy.js';
import { ToastProvider } from '../../src/ui/index.js';
import { fakeHttp } from '../workspace/helpers.js';
import { fakeConn, fold } from '../session/helpers.js';

afterEach(cleanup); beforeEach(() => { window.scrollTo = () => undefined; reset(); });
const T = 'AbCdEfGhIjKlMnOpQrStUvWxYz0'; const K = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA';
function open(path: string) {
  setState({ status: 'anonymous' }, true); const connects: unknown[] = []; const f = fakeConn(fold([], 'viewer')); setSessionLoader(async () => ({ connectSession: async (o: unknown) => { connects.push(o); return f.conn; } }) as never);
  const { router } = buildRouter({ './invite/routes.tsx': { routeModule } }, createMemoryHistory({ initialEntries: [path] })); const http = fakeHttp(() => ({}));
  render(<ToastProvider><HttpProvider http={http}><RouterProvider router={router} /></HttpProvider></ToastProvider>); return { connects, http, f };
}
describe('a watch link (C088 /g/:token, C083 guest viewer)', () => {
  it('reads the key from the address once, cleans the address, and accepts only a well-formed key and epoch', () => {
    const calls: string[] = []; const hist = { replaceState: (_s: unknown, _t: string, u: string) => { calls.push(u); } };
    expect(takeShareFragment({ hash: `#k=${K}&kid=k2`, pathname: `/g/${T}`, search: '' }, hist)).toBe(`#k=${K}&kid=k2`); expect(calls).toEqual([`/g/${T}`]);
    expect(takeShareFragment({ hash: `#k=${K}`, pathname: '/g/x', search: '?a=1' }, hist)).toBe(`#k=${K}&kid=k1`); expect(calls.at(-1)).toBe('/g/x?a=1');
    for (const bad of ['', '#k=short', `#k=${K}&kid=zz`, `#kid=k1`, `#k=${K}x`]) expect(takeShareFragment({ hash: bad, pathname: '/g/x', search: '' }, hist)).toBeUndefined();
  });
  it('a link without a key (or a bad token) shows the neutral page and never connects', async () => {
    window.history.replaceState(null, '', `/g/${T}`); const a = open(`/g/${T}`); expect(await screen.findByText("This invite isn't valid anymore.")).toBeTruthy(); expect(a.connects).toEqual([]); cleanup();
    window.history.replaceState(null, '', '/g/short#k=' + K); const b = open('/g/short'); expect(await screen.findByText("This invite isn't valid anymore.")).toBeTruthy(); expect(b.connects).toEqual([]);
  });
  it('asks for a name first, then opens the session in place as a viewer: the engine gets the token, the name and the key, the address stays clean, and nothing can be sent', async () => {
    window.history.replaceState(null, '', `/g/${T}#k=${K}&kid=k1`); const { connects, http } = open(`/g/${T}`);
    const name = await screen.findByLabelText('Your name in the session'); expect(connects).toEqual([]); expect(window.location.hash).toBe(''); expect(window.location.href).not.toContain(K);
    fireEvent.change(name, { target: { value: '  Maya  ' } }); fireEvent.click(screen.getByRole('button', { name: 'Watch as a viewer' }));
    await waitFor(() => expect(connects).toHaveLength(1)); expect(connects[0]).toMatchObject({ share: { token: T, displayName: 'Maya', fragment: `#k=${K}&kid=k1` } });
    await screen.findByText('You are watching this session.'); expect(screen.queryByLabelText('Message')).toBeNull(); expect(http.calls).toEqual([]); expect(window.location.href).not.toContain(K); expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(K);
  });
  it('an empty name cannot be submitted, and a name is cut at 40 characters', async () => {
    window.history.replaceState(null, '', `/g/${T}#k=${K}`); const { connects } = open(`/g/${T}`); const name = (await screen.findByLabelText('Your name in the session')) as HTMLInputElement;
    fireEvent.change(name, { target: { value: '   ' } }); const btn = screen.getByRole('button', { name: 'Watch as a viewer' }) as HTMLButtonElement; expect(btn.disabled || btn.getAttribute('aria-disabled') === 'true').toBe(true); expect(name.maxLength).toBe(40); expect(connects).toEqual([]);
  });
});
