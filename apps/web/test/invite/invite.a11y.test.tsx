// @vitest-environment jsdom
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../src/a11y/index.js';
import { buildRouter } from '../../src/app/router.js';
import { reset, setState } from '../../src/auth/store.js';
import { HttpProvider } from '../../src/lib/http-context.js';
import { routeModule } from '../../src/invite/routes.js';
import { ToastProvider } from '../../src/ui/index.js';
import { HttpErr, fakeHttp } from '../workspace/helpers.js';

afterEach(cleanup); beforeEach(() => { window.scrollTo = () => undefined; reset(); });
const T = 'AbCdEfGhIjKlMnOpQrStUvWxYz0';
describe('every invite state is structurally sound and keyboard operable (acceptance 8; no axe run here)', () => {
  for (const [name, path, fail] of [['ready', `/j/${T}`, false], ['invalid', '/j/short', false], ['gone', `/j/${T}`, true], ['workspace', `/i/${T}`, false], ['share', `/g/${T}`, false]] as const) it(name, async () => {
    setState({ status: 'anonymous' }, true); const http = fakeHttp((c) => { if (c.op === 'previewInvite') { if (fail) throw new HttpErr('gone', 410); return { workspace_name: 'Acme', inviter_name: 'Ada', role: 'editor', expires_at: '2026-10-14T00:00:00Z' }; } return {}; }); const { router } = buildRouter({ './invite/routes.tsx': { routeModule } }, createMemoryHistory({ initialEntries: [path] })); render(<ToastProvider><HttpProvider http={http}><RouterProvider router={router} /></HttpProvider></ToastProvider>); await screen.findByRole('main'); await new Promise((r) => setTimeout(r, 60)); await expectNoA11yViolations(document.body);
    for (const b of screen.getAllByRole('button')) expect(b.tabIndex).toBeGreaterThanOrEqual(0);
  });
});
