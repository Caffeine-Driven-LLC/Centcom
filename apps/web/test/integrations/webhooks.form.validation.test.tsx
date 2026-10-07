// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhookForm } from '../../src/integrations/components.js';
import { SecretVault, createWebhook, validateUrl } from '../../src/integrations/data.js';
import { WEBHOOK_EVENT_TYPES, groupEvents } from '../../src/integrations/events.js';
import { fakeHttp } from '../workspace/helpers.js';

afterEach(cleanup);
describe('endpoint address and events (acceptance 1, 4)', () => {
  it('http is refused on the page before any request, https goes through with an Idempotency-Key', async () => {
    const http = fakeHttp(() => ({ id: 'whk_1', url: 'https://a.example/h', events: ['session.ended'], enabled: true, status: 'healthy', created_at: 'x', secret: 'whsec_ONE' })); const onSubmit = vi.fn(async (v: { url: string; events: string[] }) => { await createWebhook(http, 'w', v, new SecretVault(), 'KEY1'); });
    render(<WebhookForm onSubmit={onSubmit} />); fireEvent.click(screen.getByLabelText('session.ended')); fireEvent.change(screen.getByLabelText('Endpoint address'), { target: { value: 'http://example.com/h' } }); fireEvent.click(screen.getByText('Create endpoint')); expect(screen.getByText('The address must start with https://.')).toBeTruthy(); expect(onSubmit).not.toHaveBeenCalled(); expect(http.calls).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Endpoint address'), { target: { value: 'https://a.example/h' } }); expect(screen.queryByText(/must start with/)).toBeNull(); fireEvent.click(screen.getByText('Create endpoint')); await new Promise((r) => setTimeout(r, 10)); expect(http.calls).toHaveLength(1); expect(http.calls[0]!.o!.idempotencyKey).toBe('KEY1'); expect(http.calls[0]!.args.body).toEqual({ url: 'https://a.example/h', events: ['session.ended'] });
  });
  it('rules: https only, no credentials in the address, localhost only in test mode', () => {
    expect(validateUrl('https://a.example/x')).toBeUndefined(); expect(validateUrl('http://a.example')).toBeTruthy(); expect(validateUrl('ftp://a.example')).toBeTruthy(); expect(validateUrl('not a url')).toBeTruthy(); expect(validateUrl('https://user:pw@a.example')).toBeTruthy(); expect(validateUrl('http://localhost:3000/h')).toBeTruthy(); expect(validateUrl('http://localhost:3000/h', { testMode: true })).toBeUndefined(); expect(validateUrl('http://evil.example', { testMode: true })).toBeTruthy();
  });
  it('the picker lists exactly the 18 types, grouped by prefix, and sends only the ticked ones', async () => {
    expect(WEBHOOK_EVENT_TYPES).toHaveLength(18); expect(groupEvents().map((g) => [g.group, g.types.length])).toEqual([['workspace', 6], ['session', 5], ['agent', 1], ['billing', 3], ['usage', 1], ['api_key', 2]]);
    const got: unknown[] = []; render(<WebhookForm onSubmit={(v) => void got.push(v)} />); expect(screen.getAllByRole('checkbox')).toHaveLength(18); fireEvent.click(screen.getByLabelText('billing.invoice.paid')); fireEvent.click(screen.getByLabelText('usage.threshold')); fireEvent.click(screen.getByLabelText('usage.threshold')); fireEvent.change(screen.getByLabelText('Endpoint address'), { target: { value: 'https://a.example/h' } }); fireEvent.click(screen.getByText('Create endpoint')); expect(got).toEqual([{ url: 'https://a.example/h', events: ['billing.invoice.paid'] }]);
  });
  it('create is off with a reason until an event is picked or when the plan limit is reached', () => { render(<WebhookForm onSubmit={() => undefined} disabledReason="Your plan has reached its number of endpoints." />); expect(screen.getByText('Create endpoint').getAttribute('aria-disabled')).toBe('true'); expect(screen.getByRole('tooltip').textContent).toContain('plan has reached'); });
});
