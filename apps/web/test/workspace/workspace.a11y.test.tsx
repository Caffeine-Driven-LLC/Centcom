// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { MembersTable, SeatBanner } from '../../src/workspace/components.js';
import { ToastProvider } from '../../src/ui/index.js';
import { fakeHttp } from './helpers.js';

afterEach(cleanup);
describe('structure for assistive tech (acceptance 7; no axe run here, the roles and names are checked directly)', () => {
  it('the members table has a caption, column headers, row cells, and every control has a name', () => {
    render(<ToastProvider><MembersTable members={[{ id: 'a', role: 'member', user: { display_name: 'Ada' }, joined_at: '2026-10-01T00:00:00Z' }, { id: 'b', role: 'guest', user: { display_name: 'Bo' } }]} me="x" myRole="owner" http={fakeHttp(() => ({}))} ws="w" onChanged={() => undefined} onRemove={() => undefined} onTransfer={() => undefined} /></ToastProvider>);
    expect(screen.getByRole('region', { name: 'Members' })).toBeTruthy(); expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Role', 'Joined', 'Actions']); expect(screen.getAllByRole('row')).toHaveLength(3); for (const b of screen.getAllByRole('button')) expect((b.textContent ?? b.getAttribute('aria-label') ?? '').length).toBeGreaterThan(0); for (const s of screen.getAllByRole('combobox')) expect(s.getAttribute('aria-label')).toMatch(/^Role of /); expect(within(screen.getAllByRole('row')[1]!).getByText('2026-10-01')).toBeTruthy();
  });
  it('the seat banner is one status message with one link, not a modal', () => { render(<SeatBanner billingHref="/w/1/billing" />); expect(screen.getByRole('alert').textContent).toContain('No free seats'); expect(screen.getAllByRole('link')).toHaveLength(1); expect(screen.getByRole('link', { name: 'See billing' }).getAttribute('href')).toBe('/w/1/billing'); expect(screen.queryByRole('dialog')).toBeNull(); });
});
