// @vitest-environment jsdom
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../shell/src/a11y/index.js';
import { buildRouter } from '../../shell/src/app/router.js';
import { FleetProvider } from '../../shell/src/fleet/routes.js';
import { routeModule } from '../../shell/src/fleet/routes.js';
import { ToastProvider } from '../../shell/src/ui/index.js';
import { ev, spawn, state, store } from './helpers.js';

afterEach(cleanup); beforeEach(() => { window.scrollTo = () => undefined; });
const open = (s: ReturnType<typeof store> | undefined) => { const { router } = buildRouter({ './fleet/routes.tsx': { routeModule } }, createMemoryHistory({ initialEntries: ['/s/ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W/fleet'] })); render(<ToastProvider><FleetProvider value={s}><RouterProvider router={router} /></FleetProvider></ToastProvider>); };
describe('the page', () => {
  it('structure is sound, colour is never the only signal, filters and the compact view work', async () => {
    const s = store(); spawn(s, 'a', 'mem_b'); state(s, 'a', 'awaiting-approval', 'mem_b'); spawn(s, 'b'); state(s, 'b', 'editing-file'); spawn(s, 'c', 'mem_c'); state(s, 'c', 'error', 'mem_c'); open(s); await screen.findAllByRole('article'); await expectNoA11yViolations(document.body);
    expect(screen.getAllByRole('article')).toHaveLength(3); fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'mem_b' } }); expect(screen.getAllByRole('article')).toHaveLength(1); fireEvent.change(screen.getByLabelText('Owner'), { target: { value: '' } }); fireEvent.change(screen.getByLabelText('State'), { target: { value: 'error' } }); expect(screen.getAllByRole('article')[0]!.getAttribute('aria-label')).toContain('Something went wrong'); fireEvent.change(screen.getByLabelText('State'), { target: { value: '' } }); fireEvent.click(screen.getByText('Compact table')); expect(document.querySelectorAll('tbody tr')).toHaveLength(3); await expectNoA11yViolations(document.body);
  });
  it('without a session the page waits instead of failing', async () => { open(undefined); await screen.findByRole('main'); expect(document.querySelector('.cc-skel')).toBeTruthy(); });
  it('a new frame updates the board at once', async () => { const s = store(); spawn(s, 'a'); state(s, 'a', 'idle'); open(s); await screen.findAllByRole('article'); expect(screen.getAllByRole('article')).toHaveLength(1); const { act } = await import('@testing-library/react'); await act(async () => { s.apply(ev('agent.spawn', 'mem_b', { agent_id: 'z', owner: 'mem_b', mode: 'branch' })); }); expect(screen.getAllByRole('article')).toHaveLength(2); });
});
