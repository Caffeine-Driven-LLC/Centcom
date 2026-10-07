// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MembersTable, ConfirmByName } from '../../src/workspace/components.js';
import { ToastProvider } from '../../src/ui/index.js';
import { HttpErr, fakeHttp } from './helpers.js';

afterEach(cleanup);
describe('typed confirmation (acceptance 6)', () => {
  it('the button repeats the verb, stays off until the exact name is typed, and Esc does not close it once something is typed', () => {
    const ok = vi.fn(); const close = vi.fn(); render(<ConfirmByName open verb="Delete workspace" name="Acme" onConfirm={ok} onClose={close} />); const dlg = screen.getByRole('dialog'); expect(dlg.getAttribute('aria-modal')).toBe('true'); const btn = screen.getByRole('button', { name: 'Delete workspace' }); fireEvent.click(btn); expect(ok).not.toHaveBeenCalled(); expect(btn.getAttribute('aria-disabled')).toBe('true');
    const input = screen.getByLabelText('Type Acme to confirm'); fireEvent.change(input, { target: { value: 'acme' } }); fireEvent.click(btn); expect(ok).not.toHaveBeenCalled(); fireEvent.change(input, { target: { value: 'Acme' } }); fireEvent.click(btn); expect(ok).toHaveBeenCalledTimes(1); fireEvent.keyDown(dlg, { key: 'Escape' }); expect(close).not.toHaveBeenCalled(); expect(dlg.querySelector('svg, img, canvas')).toBeNull();
  });
  it('transfer ownership asks the same way', () => { render(<ConfirmByName open verb="Transfer ownership" name="Acme" onConfirm={() => undefined} onClose={() => undefined} detail="The new owner can delete the workspace." />); expect(screen.getByRole('button', { name: 'Transfer ownership' })).toBeTruthy(); expect(screen.getByText(/new owner can delete/)).toBeTruthy(); });
});
describe('role select (acceptance 5)', () => {
  it('a refused role change (403) shows a danger toast and the select goes back to the old value at once', async () => {
    const http = fakeHttp(() => { throw new HttpErr('forbidden', 403); }); const members = [{ id: 'mem_2', role: 'member', user: { display_name: 'Ben' } }]; render(<ToastProvider ttlMs={0}><MembersTable members={members} me="mem_1" myRole="admin" http={http} ws="w" onChanged={() => undefined} onRemove={() => undefined} onTransfer={() => undefined} /></ToastProvider>);
    const sel = screen.getByLabelText('Role of Ben') as HTMLSelectElement; expect(sel.value).toBe('member'); fireEvent.change(sel, { target: { value: 'guest' } }); expect(sel.value).toBe('guest'); await new Promise((r) => setTimeout(r, 50)); expect((screen.getByLabelText('Role of Ben') as HTMLSelectElement).value).toBe('member'); expect(screen.getByRole('region', { name: 'Notifications' }).textContent).toContain('not allowed'); expect(http.calls[0]).toMatchObject({ op: 'updateMember', args: { id: 'w', mem: 'mem_2', body: { role: 'guest' } } });
  });
  it('a member who cannot change roles sees the role as a chip, not a select; the owner row has no remove', () => {
    render(<ToastProvider><MembersTable members={[{ id: 'o', role: 'owner' }, { id: 'm', role: 'member' }]} me="x" myRole="member" http={fakeHttp(() => ({}))} ws="w" onChanged={() => undefined} onRemove={() => undefined} onTransfer={() => undefined} /></ToastProvider>); expect(screen.queryByRole('combobox')).toBeNull(); expect(screen.queryByText('Remove')).toBeNull();
  });
});
