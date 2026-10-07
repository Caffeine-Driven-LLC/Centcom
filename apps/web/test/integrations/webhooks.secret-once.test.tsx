// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { SecretModal } from '../../shell/src/integrations/components.js';
import { SecretVault, createWebhook, rotateSecret } from '../../shell/src/integrations/data.js';
import { ToastProvider } from '../../shell/src/ui/index.js';
import { fakeHttp } from '../workspace/helpers.js';

afterEach(cleanup);
const SECRET = 'whsec_CANARY_9f31';
describe('the secret is shown once (acceptance 2, 3)', () => {
  it('create puts it in the vault only; the modal shows it; "I saved it" clears the vault and the page', async () => {
    const vault = new SecretVault(); const http = fakeHttp(() => ({ id: 'whk_1', url: 'https://a/h', events: ['session.ended'], enabled: true, status: 'healthy', created_at: 'x', secret: SECRET })); const r = await createWebhook(http, 'w', { url: 'https://a.example/h', events: ['session.ended'] }, vault, 'K'); expect(r.ok).toBe(true); expect(JSON.stringify(r)).not.toContain(SECRET); expect(vault.open).toBe(true);
    let closed = 0; const { rerender } = render(<ToastProvider><SecretModal vault={vault} onClose={() => closed++} /></ToastProvider>); expect(screen.getByTestId('secret').textContent).toBe(SECRET); expect(screen.getByText(/Centcom-Signature: t=/)).toBeTruthy(); expect(screen.getByText(/300 s/)).toBeTruthy(); expect(document.querySelector('pre')!.textContent).not.toContain(SECRET);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(screen.getByTestId('secret')).toBeTruthy(); /* Esc does not drop it */ fireEvent.click(screen.getByText('I saved it')); expect(closed).toBe(1); expect(vault.get()).toBeUndefined(); rerender(<ToastProvider><SecretModal vault={vault} onClose={() => closed++} /></ToastProvider>); expect(document.body.textContent).not.toContain(SECRET);
  });
  it('a fresh page has no way to get it back: nothing in storage, nothing in the vault, nothing in the DOM', async () => {
    const vault = new SecretVault(); await createWebhook(fakeHttp(() => ({ id: 'w', url: 'https://a/h', events: ['x'], enabled: true, status: 'h', created_at: 'x', secret: SECRET })), 'w', { url: 'https://a.example/h', events: ['x'] }, vault, 'K'); render(<ToastProvider><SecretModal vault={vault} onClose={() => undefined} /></ToastProvider>); fireEvent.click(screen.getByText('I saved it'));
    expect(JSON.stringify({ ...localStorage })).not.toContain(SECRET); expect(JSON.stringify({ ...sessionStorage })).not.toContain(SECRET); expect(location.href + document.cookie).not.toContain(SECRET); cleanup(); const fresh = new SecretVault(); render(<ToastProvider><SecretModal vault={fresh} onClose={() => undefined} /></ToastProvider>); expect(document.body.textContent).not.toContain(SECRET); expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('rotating shows the new secret once with the 24 hour overlap note', async () => {
    const vault = new SecretVault(); const r = await rotateSecret(fakeHttp(() => ({ id: 'w', url: 'u', events: [], enabled: true, status: 'h', created_at: 'x', secret: 'whsec_NEW', secret_overlap_until: '2026-10-08T00:00:00Z' })), 'whk_1', vault); expect(r).toMatchObject({ ok: true, overlapUntil: '2026-10-08T00:00:00Z' }); render(<ToastProvider><SecretModal vault={vault} rotated onClose={() => undefined} /></ToastProvider>); expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBeTruthy(); expect(screen.getByText('New signing secret')).toBeTruthy(); expect(screen.getByText(/24 hours/)).toBeTruthy(); expect(screen.getByText(/both v1 signatures/)).toBeTruthy();
  });
  it('a rotation that returns no secret opens nothing', async () => { const vault = new SecretVault(); await rotateSecret(fakeHttp(() => ({ id: 'w', url: 'u', events: [], enabled: true, status: 'h', created_at: 'x' })), 'w', vault); expect(vault.open).toBe(false); });
});
