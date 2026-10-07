// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpErr } from '../workspace/helpers.js';
import { setup } from './setup.js';

afterEach(cleanup); beforeEach(() => { window.scrollTo = () => undefined; });
describe('who can do what (acceptance 5)', () => {
  for (const role of ['member', 'guest']) it(`${role}: a neutral page and no data request`, async () => { const { http } = setup('/billing', { role }); expect(await screen.findByText('Billing is for owners, admins and the billing role.')).toBeTruthy(); expect(http.calls.map((c) => c.op)).not.toContain('getEntitlements'); expect(http.calls.map((c) => c.op)).not.toContain('getSubscription'); });
  it('an admin sees billing but the buttons that spend say why they are off', async () => { setup('/billing/plans', { role: 'admin' }); await screen.findByText('Choose Pro'); expect(screen.getByText('Choose Pro').getAttribute('aria-disabled')).toBe('true'); expect(screen.getAllByRole('tooltip').some((t) => t.textContent === 'Only the owner and the billing role can change the plan.')).toBe(true); });
  it('the billing role can choose a plan: the checkout goes out with a key and the browser is sent to the hosted page, and a 403 is a toast', async () => {
    const assign = vi.fn(); Object.defineProperty(window, 'location', { value: { ...window.location, assign, origin: 'https://app.centcom.dev' }, writable: true });
    const { http } = setup('/billing/plans', { role: 'billing', extra: (c) => (c.op === 'createCheckout' ? { url: 'https://checkout.example/s/9' } : undefined) }); fireEvent.click(await screen.findByText('Choose Pro')); await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.example/s/9')); const call = http.calls.find((c) => c.op === 'createCheckout')!; expect(call.o!.idempotencyKey).toBeTruthy(); expect(call.args.body).toMatchObject({ plan: 'pro', interval: 'month', success_url: 'https://app.centcom.dev/billing?checkout=success', cancel_url: 'https://app.centcom.dev/billing/plans' }); expect(document.querySelector('iframe, input[autocomplete^="cc-"]')).toBeNull();
    cleanup(); assign.mockClear(); setup('/billing/plans', { role: 'owner', extra: (c) => { if (c.op === 'createCheckout') throw new HttpErr('forbidden', 403); return undefined; } }); fireEvent.click(await screen.findByText('Choose Team')); expect((await screen.findByRole('region', { name: 'Notifications' })).textContent).toBeTruthy(); await waitFor(() => expect(screen.getByRole('region', { name: 'Notifications' }).textContent).toContain('not allowed')); expect(assign).not.toHaveBeenCalled();
  });
  it('plans show price, interval and a tax note, and yearly prices follow the choice', async () => { setup('/billing/plans'); await screen.findByText('Choose Pro'); expect(screen.getAllByText(/\$19\.00/).length).toBe(1); expect(screen.getAllByText(/Tax is added at checkout/, { selector: 'p' }).length).toBe(2); fireEvent.change(screen.getByLabelText('Billed'), { target: { value: 'year' } }); expect(await screen.findByText(/\$190\.00/)).toBeTruthy(); });
  it('a failed fetch of the billing data says so without crashing', async () => { setup('/billing', { extra: (c) => { if (c.op === 'getEntitlements') throw new HttpErr('internal_error', 500); return undefined; } }); expect(await screen.findByText('Billing could not be loaded.')).toBeTruthy(); });
});
describe('after the return from checkout (acceptance 6)', () => {
  it('no mascot and no payment fields on any billing route', async () => { for (const p of ['/billing', '/billing/plans', '/billing/seats', '/billing/invoices']) { cleanup(); setup(p); await screen.findByRole('main'); await new Promise((r) => setTimeout(r, 30)); expect(document.querySelector('canvas, img, [data-mascot], iframe, input[autocomplete^="cc-"]')).toBeNull(); expect(document.querySelector('main')!.innerHTML).not.toMatch(/mascot|cento/i); } });
});
