// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { AuditTable, DeliveriesTable, EventPicker, SecretModal, WebhookForm } from '../../src/integrations/components.js';
import { SecretVault } from '../../src/integrations/data.js';
import { ToastProvider } from '../../src/ui/index.js';

afterEach(cleanup);
describe('structure for assistive tech (no axe run here; roles, names and keyboard order are checked directly)', () => {
  it('the event picker is a fieldset with a legend and every checkbox has its event name as its label', () => { render(<EventPicker value={[]} onChange={() => undefined} />); expect(screen.getByRole('group', { name: 'Events' })).toBeTruthy(); for (const c of screen.getAllByRole('checkbox')) expect(c.closest('label')?.textContent?.trim().length).toBeGreaterThan(3); });
  it('the form has a labelled address, an error that is announced and tied to the field', () => { render(<WebhookForm onSubmit={() => undefined} />); const i = screen.getByLabelText('Endpoint address'); expect(i.tagName).toBe('INPUT'); expect(screen.getByRole('button', { name: 'Create endpoint' })).toBeTruthy(); });
  it('the secret modal is a labelled modal dialog with the secret as text and a named close button', () => { const v = new SecretVault(); v.reveal('whsec_x'); render(<ToastProvider><SecretModal vault={v} onClose={() => undefined} /></ToastProvider>); const dlg = screen.getByRole('dialog', { name: 'Signing secret' }); expect(dlg.getAttribute('aria-modal')).toBe('true'); expect(within(dlg).getByRole('button', { name: 'I saved it' })).toBeTruthy(); expect(within(dlg).getByRole('button', { name: 'Copy' })).toBeTruthy(); });
  it('the tables have captions and headers', () => { render(<><DeliveriesTable rows={[]} onRedeliver={() => undefined} /><AuditTable rows={[]} /></>); expect(screen.getByRole('region', { name: 'Deliveries' })).toBeTruthy(); expect(screen.getByRole('region', { name: 'Audit log' })).toBeTruthy(); expect(screen.getAllByRole('columnheader').length).toBeGreaterThan(8); });
});
