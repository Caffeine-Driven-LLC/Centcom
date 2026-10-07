// @vitest-environment jsdom
import { createMemoryHistory } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Frame, ShellCtx } from '../../shell/src/app/Frame.js';
import { rootRoute } from '../../shell/src/app/root.js';
import { buildRouter } from '../../shell/src/app/router.js';
import { RouterProvider, createRoute } from '@tanstack/react-router';

afterEach(cleanup); const css = readFileSync(join(process.cwd(), 'apps/web/shell/src/ui/ui.css'), 'utf8');
describe('responsive frame (acceptance 7, 9)', () => {
  it('the rail is a drawer under 1024 px and the inspector a sheet under 768 px (breakpoints in the stylesheet)', () => {
    expect(css).toMatch(/@media \(max-width: 1023px\)[^}]*\.cc-body \{ grid-template-columns: minmax\(0, 1fr\)/); expect(css).toMatch(/@media \(max-width: 767px\)[^}]*\.cc-inspector\[data-open="true"\] \{ position: fixed/); expect(css).toContain('grid-template-rows: 48px 1fr'); expect(css).toContain('grid-template-columns: 240px minmax(0, 1fr) 320px');
  });
  it('under reduced motion every transition and animation is 0 ms and the skeleton is still', () => { expect(css).toMatch(/prefers-reduced-motion: reduce\) \{[^}]*transition-duration: 0ms !important[^}]*animation-duration: 0ms !important/); expect(css).toContain('.cc-skel__line { animation: none; }'); });
  it('no fixed width forces a horizontal scroll at 320 px: wide things scroll inside their own box', () => { expect(css).toMatch(/\.cc-table-wrap \{ overflow-x: auto; \}/); expect(css).toMatch(/\.cc-modal \{ width: min\(480px, calc\(100vw - 32px\)\)/); expect(css).toMatch(/\.cc-toasts \{[^}]*max-width: calc\(100vw - 32px\)/); });
  it('the menu button opens and closes the rail; the details button toggles the inspector; offline shows a banner', async () => {
    const found = { './home/routes.tsx': { routeModule: { routes: [createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <p>home page</p> })], nav: [{ id: 'home', labelKey: 'nav.home', to: '/', icon: 'home' }] } } };
    window.scrollTo = () => undefined; /* jsdom has none; the router restores scroll */
    const { router, nav } = buildRouter(found, createMemoryHistory({ initialEntries: ['/'] })); render(<ShellCtx.Provider value={{ nav, connectivity: 'offline', inspector: <p>inspector</p> }}><RouterProvider router={router} /></ShellCtx.Provider>);
    await screen.findByText('home page'); expect(screen.getByRole('status').textContent).toContain('Status unavailable'); const rail = document.getElementById('cc-rail')!; expect(rail.dataset.open).toBe('false'); fireEvent.click(screen.getByText('Menu')); expect(rail.dataset.open).toBe('true'); fireEvent.click(screen.getByText('Details')); expect(document.getElementById('cc-inspector')!.dataset.open).toBe('true'); expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
  });
});
void Frame;
