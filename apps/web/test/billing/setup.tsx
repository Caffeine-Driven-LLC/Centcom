import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import React from 'react';
import { buildRouter } from '../../shell/src/app/router.js';
import { HttpProvider } from '../../shell/src/lib/http-context.js';
import { routeModule } from '../../shell/src/billing/routes.js';
import { ToastProvider } from '../../shell/src/ui/index.js';
import { fakeHttp, type Call } from '../workspace/helpers.js';

export const baseEnt = (o: Record<string, unknown> = {}) => ({ workspace: 'wsp_1', rev: 5, plan: 'team', status: 'active', limits: { relay_access: true, lan_multiplayer: true, max_seats: 5, max_session_members: 8, max_concurrent_sessions: 3, max_parallel_agents: 4, history_days: 30, queue_items_month: null, audit_log_days: 0, webhooks_max: 5, api_keys_max: 10, hosted_minutes_month: 1000, mystery_limit: 7 }, usage: { seats: 3, queue_items_month: 40, hosted_minutes_month: 100 }, warnings: [], ...o });
export const baseSub = (o: Record<string, unknown> = {}) => ({ id: 'sub_1', workspace: 'wsp_1', plan: 'team', status: 'active', seats: 3, interval: 'month', currency: 'USD', current_period_end: '2026-11-01T00:00:00Z', ...o });
export function setup(path: string, o: { role?: string; ent?: unknown; sub?: unknown; extra?: (c: Call) => unknown; pages?: Parameters<typeof fakeHttp>[1] } = {}) {
  const http = fakeHttp((c) => { const x = o.extra?.(c); if (x !== undefined) return x; switch (c.op) { case 'getMe': return { user: { id: 'usr_1' }, active_workspace: 'wsp_1', plan: 'team', ent: 5 }; case 'getWorkspace': return { id: 'wsp_1', name: 'Acme', role: o.role ?? 'owner' }; case 'getEntitlements': return o.ent ?? baseEnt(); case 'getSubscription': return o.sub ?? baseSub(); default: return {}; } }, { listPlans: () => ({ data: [{ id: 'free', name: 'Free', prices: [], limits: {} }, { id: 'pro', name: 'Pro', prices: [{ interval: 'month', currency: 'USD', amount: 1900, per_seat: true }, { interval: 'year', currency: 'USD', amount: 19000, per_seat: true }], limits: {} }, { id: 'team', name: 'Team', prices: [{ interval: 'month', currency: 'USD', amount: 4900, per_seat: true }], limits: {} }], has_more: false }), listInvoices: () => ({ data: [{ id: 'in_1', number: 'CC-0001', status: 'paid', amount_due: { amount: 4900, currency: 'USD' }, amount_paid: { amount: 4900, currency: 'USD' }, created_at: '2026-10-01T00:00:00Z', hosted_invoice_url: 'https://pay.example/in_1' }], has_more: false }), ...(o.pages ?? {}) });
  const { router } = buildRouter({ './billing/routes.tsx': { routeModule } }, createMemoryHistory({ initialEntries: [path] })); render(<ToastProvider ttlMs={0}><HttpProvider http={http}><RouterProvider router={router} /></HttpProvider></ToastProvider>); return { http, router };
}
