// @vitest-environment jsdom
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRouter } from '../../src/app/router.js';
import { HttpProvider } from '../../src/lib/http-context.js';
import { routeModule } from '../../src/settings/routes.js';
import { CATEGORIES, QUIET_NOTE, allowedByQuietHours, effective, toggleChannel, validateQuiet } from '../../src/settings/model.js';
import { savePreferences } from '../../src/settings/data.js';
import { ToastProvider } from '../../src/ui/index.js';
import { HttpErr, fakeHttp, type Call } from '../workspace/helpers.js';

afterEach(cleanup); beforeEach(() => { window.scrollTo = () => undefined; });
const prefs = () => ({ channels: { mention: { inbox: true, push: false, email: false, os: false } }, quiet_hours: { enabled: false, start: '22:00', end: '07:00', timezone: 'UTC' } });
function setup(path: string, extra?: (c: Call) => unknown, pages: Parameters<typeof fakeHttp>[1] = {}) { const http = fakeHttp((c) => extra?.(c) ?? (c.op === 'getNotificationPreferences' ? { data: prefs(), etag: '"p1"', replayed: false, status: 200 } : c.op === 'replaceNotificationPreferences' ? { data: c.args.body, etag: '"p2"', replayed: false, status: 200 } : {}), pages); const { router } = buildRouter({ './settings/routes.tsx': { routeModule } }, createMemoryHistory({ initialEntries: [path] })); render(<ToastProvider ttlMs={0}><HttpProvider http={http}><RouterProvider router={router} /></HttpProvider></ToastProvider>); return http; }
describe('rules (acceptance 4)', () => {
  it('security_alert and billing_issue keep their inbox on, whatever is asked; others can be switched', () => { const p = prefs(); for (const c of ['security_alert', 'billing_issue']) { expect(effective(p, c, 'inbox')).toBe(true); expect(effective(toggleChannel(p, c, 'inbox', false), c, 'inbox')).toBe(true); expect(toggleChannel(p, c, 'push', true).channels).toMatchObject({ [c]: { push: true } }); } expect(effective(toggleChannel(p, 'mention', 'inbox', false), 'mention', 'inbox')).toBe(false); });
  it('quiet hours never hold back a security alert or a billing problem', () => { const q = { enabled: true, start: '22:00', end: '07:00', timezone: 'UTC' }; const night = Date.UTC(2026, 9, 7, 23, 0); expect(allowedByQuietHours({ category: 'mention', priority: 'normal' }, q, night)).toBe(false); expect(allowedByQuietHours({ category: 'security_alert', priority: 'urgent' }, q, night)).toBe(true); expect(allowedByQuietHours({ category: 'billing_issue', priority: 'high' }, q, night)).toBe(true); expect(validateQuiet({ ...q, start: '25:00' })).toBeTruthy(); expect(validateQuiet({ ...q, end: '22:00' })).toBeTruthy(); expect(validateQuiet(q)).toBeUndefined(); });
});
describe('the page', () => {
  it('a matrix of 14 categories by 4 channels; the locked boxes are on and disabled; the quiet-hours note is there', async () => {
    setup('/settings/notifications'); await screen.findByText('Channels by category', { selector: 'caption' }); expect(screen.getAllByRole('row')).toHaveLength(15); const sec = screen.getByRole('checkbox', { name: 'security alert, inbox' }) as HTMLInputElement; expect(sec.checked).toBe(true); expect(sec.disabled).toBe(true); expect((screen.getByRole('checkbox', { name: 'billing issue, inbox' }) as HTMLInputElement).disabled).toBe(true); expect((screen.getByRole('checkbox', { name: 'mention, inbox' }) as HTMLInputElement).disabled).toBe(false); expect(screen.getByText(QUIET_NOTE)).toBeTruthy(); expect(CATEGORIES.length * 4).toBe(56);
  });
  it('a change is saved with If-Match and the new ETag is used next time', async () => { const http = setup('/settings/notifications'); fireEvent.click(await screen.findByRole('checkbox', { name: 'mention, email' })); await waitFor(() => expect(http.calls.some((c) => c.op === 'replaceNotificationPreferences')).toBe(true)); expect(http.calls.find((c) => c.op === 'replaceNotificationPreferences')!.o!.ifMatch).toBe('"p1"'); fireEvent.click(screen.getByRole('checkbox', { name: 'mention, os' })); await waitFor(() => expect(http.calls.filter((c) => c.op === 'replaceNotificationPreferences')).toHaveLength(2)); expect(http.calls.filter((c) => c.op === 'replaceNotificationPreferences')[1]!.o!.ifMatch).toBe('"p2"'); });
  it('a stale ETag (412) reloads the newest values and applies the change on top, with a notice', async () => {
    const theirs = { channels: { mention: { inbox: false, push: true } }, quiet_hours: prefs().quiet_hours }; let puts = 0; const http = fakeHttp((c) => { if (c.op === 'getNotificationPreferences') return { data: puts ? theirs : prefs(), etag: puts ? '"p9"' : '"p1"', replayed: false, status: 200 }; if (puts++ === 0) throw new HttpErr('precondition_failed', 412); return { data: c.args.body, etag: '"p10"', replayed: false, status: 200 }; });
    const r = await savePreferences(http, toggleChannel(prefs(), 'mention', 'email', true), '"p1"', (t) => toggleChannel(t, 'mention', 'email', true)); expect(r).toMatchObject({ ok: true, etag: '"p10"', notice: expect.stringContaining('changed somewhere else') }); const last = http.calls.at(-1)!; expect(last.o!.ifMatch).toBe('"p9"'); expect((last.args.body as { channels: Record<string, Record<string, boolean>> }).channels.mention).toEqual({ inbox: false, push: true, email: true });
  });
});
