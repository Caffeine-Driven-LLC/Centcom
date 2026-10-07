// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../shell/src/a11y/index.js';
import { setup } from './setup.js';

afterEach(cleanup); beforeEach(() => { window.scrollTo = () => undefined; });
describe('structure and numbers (acceptance 8; no Lighthouse run here)', () => {
  it('every billing page has no serious structural problem', async () => { for (const [p, name] of [['/billing', 'Usage'], ['/billing/plans', 'Plans'], ['/billing/seats', 'Seats'], ['/billing/invoices', 'Invoices']] as const) { cleanup(); setup(p); await screen.findAllByRole('region', { name }); await new Promise((r) => setTimeout(r, 40)); await expectNoA11yViolations(document.body); } });
  it('invoice amounts are tabular and right-aligned, the number links to the hosted invoice only over https', async () => { setup('/billing/invoices'); const t = await screen.findByRole('region', { name: 'Invoices', hidden: false }); await screen.findByText('CC-0001'); const link = screen.getByRole('link', { name: 'CC-0001' }); expect(link.getAttribute('href')).toBe('https://pay.example/in_1'); expect(within(document.querySelector('.cc-table-wrap')!).getAllByText('$49.00')).toHaveLength(2); expect(document.querySelectorAll('.cc-num')).toHaveLength(2); expect(t).toBeTruthy(); });
  it('the stylesheet gives numbers tabular figures and right alignment', async () => { const { readFileSync } = await import('node:fs'); const { join } = await import('node:path'); const css = readFileSync(join(process.cwd(), 'apps/web/shell/src/ui/ui.css'), 'utf8'); expect(css).toMatch(/\.cc-num \{[^}]*font-variant-numeric: tabular-nums/); expect(css).toMatch(/text-align: right/); });
});
