import { describe, expect, it } from 'vitest';
import { statusView } from '../../shell/src/billing/model.js';
import { baseSub } from './setup.js';

const NOW = Date.UTC(2026, 9, 7, 12); const day = 86_400_000;
describe('status matrix (acceptance 7)', () => {
  const s = (o: Record<string, unknown>) => statusView(baseSub(o) as never, NOW);
  it('none and no subscription are the free plan', () => { expect(statusView(undefined, NOW)).toMatchObject({ label: 'Free', paid: false, freeBehaviour: true }); expect(s({ status: 'none' })).toMatchObject({ freeBehaviour: true, paid: false }); });
  it('active is paid with no banner', () => { expect(s({ status: 'active' })).toMatchObject({ label: 'Active', paid: true, freeBehaviour: false }); expect(s({ status: 'active' }).banner).toBeUndefined(); });
  it('trialing says when the trial ends', () => { const v = s({ status: 'trialing', trial_end: '2026-10-14T00:00:00Z' }); expect(v).toMatchObject({ paid: true }); expect(v.banner!.text).toBe('Your trial ends on Oct 14, 2026.'); });
  it('past due counts down the grace period and offers the payment method; after it the workspace behaves as free', () => {
    const v = s({ status: 'past_due', grace_until: new Date(NOW + 3 * day + 3_600_000).toISOString() }); expect(v).toMatchObject({ freeBehaviour: false, paid: true }); expect(v.banner).toMatchObject({ tone: 'danger', action: 'portal', title: '! Payment failed' }); expect(v.banner!.text).toBe('Update your payment method within 3 days to keep your plan.');
    expect(s({ status: 'past_due', grace_until: new Date(NOW + 5 * 3_600_000).toISOString() }).banner!.text).toContain('within 5 hours'); expect(s({ status: 'past_due', grace_until: new Date(NOW + day).toISOString() }).banner!.text).toContain('within 1 day'); expect(s({ status: 'past_due' }).banner!.text).toBe('Update your payment method to keep your plan.');
    const over = s({ status: 'past_due', grace_until: new Date(NOW - 1000).toISOString() }); expect(over).toMatchObject({ freeBehaviour: true, paid: false }); expect(over.banner!.text).toContain('back on the free plan'); expect(over.banner!.action).toBe('portal');
  });
  it('canceled keeps the plan until the period ends, then is free', () => { const run = s({ status: 'canceled', current_period_end: '2026-11-01T00:00:00Z' }); expect(run).toMatchObject({ paid: true, freeBehaviour: false }); expect(run.banner!.text).toContain('stays until Nov 1, 2026'); const gone = s({ status: 'canceled', current_period_end: '2026-09-01T00:00:00Z' }); expect(gone).toMatchObject({ paid: false, freeBehaviour: true }); expect(gone.banner!.text).toContain('has ended'); });
  it('an unknown status is shown as it is and gets no paid behaviour', () => { expect(s({ status: 'paused' })).toMatchObject({ label: 'paused', paid: false, freeBehaviour: true }); });
});
