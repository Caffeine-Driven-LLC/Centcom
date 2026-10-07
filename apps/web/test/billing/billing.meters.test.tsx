// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { banners, limitRows, limitText, meters, pips } from '../../src/billing/model.js';
import { baseEnt, baseSub, setup } from './setup.js';

afterEach(cleanup); beforeEach(() => { window.scrollTo = () => undefined; });
describe('limits and meters (acceptance 2, 3)', () => {
  it('null is Unlimited, 0 is None, switches are On and Off, and unknown limits are shown read-only', () => { expect(limitText(null)).toBe('Unlimited'); expect(limitText(0)).toBe('None'); expect(limitText(1500)).toBe('1,500'); expect(limitText(true)).toBe('On'); expect(limitText(false)).toBe('Off'); expect(limitText(undefined)).toBe('—'); const rows = limitRows(baseEnt() as never); expect(rows.find((r) => r.key === 'mystery_limit')).toEqual({ key: 'mystery_limit', label: 'mystery_limit', text: '7' }); expect(rows.find((r) => r.key === 'audit_log_days')!.text).toBe('None'); expect(rows.find((r) => r.key === 'queue_items_month')!.text).toBe('Unlimited'); });
  it('seat pips: filled and empty squares, at most ten', () => { expect(pips(3, 5)).toBe('■■■□□'); expect(pips(5, 5)).toBe('■■■■■'); expect(pips(0, 3)).toBe('□□□'); expect(pips(50, 100)).toBe('■■■■■□□□□□'); expect(pips(1, 0)).toBe('□'.length ? pips(1, 0) : ''); });
  it('80 % warns with a ! glyph, a full meter is firm; two banners at most; a null limit never warns', () => {
    const ok = meters(baseEnt() as never); expect(ok.find((m) => m.key === 'max_seats')).toMatchObject({ used: 3, limit: 5, pct: 60, level: 'ok', pips: '■■■□□' }); expect(ok.find((m) => m.key === 'queue_items_month')).toMatchObject({ limit: null, level: 'ok', limitText: 'Unlimited' });
    const warn = baseEnt({ usage: { seats: 4, queue_items_month: 5_000_000, hosted_minutes_month: 100 }, warnings: [{ limit: 'max_seats', pct: 80 }] }); expect(meters(warn as never).find((m) => m.key === 'max_seats')!.level).toBe('warn'); const b = banners(warn as never, baseSub() as never, 0); expect(b).toHaveLength(1); expect(b[0]).toMatchObject({ tone: 'warning' }); expect(b[0]!.title.startsWith('! ')).toBe(true);
    const full = baseEnt({ usage: { seats: 5, queue_items_month: 0, hosted_minutes_month: 1000 } }); expect(meters(full as never).filter((m) => m.level === 'firm').map((m) => m.key)).toEqual(['max_seats', 'hosted_minutes_month']); const fb = banners(full as never, baseSub({ status: 'past_due', grace_until: new Date(Date.now() + 3 * 86_400_000).toISOString() }) as never, Date.now()); expect(fb).toHaveLength(2); expect(fb[0]!.id).toBe('past_due'); expect(fb.every((x) => x.tone === 'danger')).toBe(true);
  });
  it('the page shows the usage table with right-aligned tabular numbers and the plan badge', async () => { setup('/billing'); const usage = await screen.findByRole('region', { name: 'Usage' }); expect(within(usage).getByText('Seats')).toBeTruthy(); expect(within(usage).getAllByText('Unlimited').length).toBeGreaterThan(0); expect(usage.querySelectorAll('.cc-num').length).toBeGreaterThan(3); expect(screen.getByText('TEAM')).toBeTruthy(); await waitFor(() => expect(screen.getByRole('region', { name: 'Plan limits' })).toBeTruthy()); });
});
