// @vitest-environment jsdom
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRouter } from '../../src/app/router.js';
import { HttpProvider } from '../../src/lib/http-context.js';
import { routeModule } from '../../src/integrations/routes.js';
import { ToastProvider } from '../../src/ui/index.js';
import { fakeHttp, type Call } from '../workspace/helpers.js';

afterEach(cleanup); beforeEach(() => { window.scrollTo = () => undefined; });
function setup(path: string, role: string, limits: Record<string, number> = { webhooks_max: 5, audit_log_days: 30 }, extra?: (c: Call) => unknown) { const http = fakeHttp((c) => extra?.(c) ?? (c.op === 'getWorkspace' ? { id: 'w', name: 'Acme', role } : c.op === 'getEntitlements' ? { limits } : {}), { listWebhooks: () => ({ data: [{ id: 'whk_1', url: 'https://a.example/h', events: ['session.ended'], enabled: true, status: 'failing', created_at: 'x' }], has_more: false }), listAuditEvents: () => ({ data: [], has_more: false }) }); const { router } = buildRouter({ './integrations/routes.tsx': { routeModule } }, createMemoryHistory({ initialEntries: [path] })); render(<ToastProvider ttlMs={0}><HttpProvider http={http}><RouterProvider router={router} /></HttpProvider></ToastProvider>); return http; }
describe('who may see these pages (acceptance 8)', () => {
  for (const role of ['member', 'billing', 'guest']) for (const path of ['/w/w/webhooks', '/w/w/audit', '/w/w/webhooks/whk_1']) it(`${role} on ${path}: a neutral page and not one request for the data`, async () => {
    const http = setup(path, role); expect(await screen.findByText('You do not have access to this page.')).toBeTruthy(); expect(http.calls.map((c) => c.op).filter((o) => !['getWorkspace'].includes(o))).toEqual([]);
  });
  it('an admin gets the list, with the failing endpoint marked', async () => { const http = setup('/w/w/webhooks', 'admin'); expect(await screen.findByText('https://a.example/h')).toBeTruthy(); expect(screen.getByText('failing')).toBeTruthy(); expect(http.calls.some((c) => c.op === 'listWebhooks')).toBe(true); });
  it('webhooks_max 0 shows the upgrade hint with a billing link and no create form', async () => { setup('/w/w/webhooks', 'owner', { webhooks_max: 0, audit_log_days: 30 }); expect(await screen.findByText('Webhooks are not in your plan')).toBeTruthy(); expect(screen.getByRole('link', { name: 'See billing' })).toBeTruthy(); expect(screen.queryByText('Create endpoint')).toBeNull(); });
  it('at the plan limit the create button is off with the reason', async () => { setup('/w/w/webhooks', 'owner', { webhooks_max: 1, audit_log_days: 30 }); await screen.findByText('https://a.example/h'); await waitFor(() => expect(screen.getByText('Create endpoint').getAttribute('aria-disabled')).toBe('true')); expect(screen.getAllByRole('tooltip').some((t) => t.textContent!.includes('number of endpoints'))).toBe(true); });
  it('audit_log_days 0 shows the feature-off state with a billing link and asks for no events', async () => { const http = setup('/w/w/audit', 'admin', { webhooks_max: 5, audit_log_days: 0 }); expect(await screen.findByText('The audit log is not in your plan')).toBeTruthy(); expect(screen.getByRole('link', { name: 'See billing' })).toBeTruthy(); expect(http.calls.some((c) => c.op === 'listAuditEvents')).toBe(false); });
});
