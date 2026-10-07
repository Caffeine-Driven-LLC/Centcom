// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShortcutHost, eventKeys, listShortcuts, normaliseKeys, registerShortcut, remapShortcut, resetShortcuts, setConflictLogger } from '../../shell/src/a11y/index.js';

afterEach(() => { cleanup(); resetShortcuts(); setConflictLogger((m) => console.error(m)); });
describe('shortcut registry (acceptance 8)', () => {
  it('a clash in one scope is logged as a developer error, a different scope is fine', () => { const log = vi.fn(); setConflictLogger(log); registerShortcut({ id: 'a', keys: 'g', labelKey: 'nav.home', scope: 'global', handler: () => undefined }); registerShortcut({ id: 'b', keys: 'G', labelKey: 'nav.menu', scope: 'global', handler: () => undefined }); expect(log).toHaveBeenCalledTimes(1); expect(log.mock.calls[0]![0]).toContain('a and b'); registerShortcut({ id: 'c', keys: 'g', labelKey: 'nav.menu', scope: 'session', handler: () => undefined }); expect(log).toHaveBeenCalledTimes(1); });
  it('keys are written in one normal form', () => { expect(normaliseKeys('Shift+Ctrl+K')).toBe('ctrl+shift+k'); expect(eventKeys({ key: 'K', ctrlKey: true })).toBe('ctrl+k'); expect(eventKeys({ key: 'ArrowUp' })).toBe('arrowup'); });
  it('a remap is refused when the keys are taken, accepted otherwise, and the list shows the new keys', () => { registerShortcut({ id: 'a', keys: 'g', labelKey: 'nav.home', scope: 'global', handler: () => undefined }); registerShortcut({ id: 'b', keys: 'h', labelKey: 'nav.menu', scope: 'global', handler: () => undefined }); expect(remapShortcut('b', 'g')).toEqual({ ok: false, other: 'a' }); expect(remapShortcut('b', 'Ctrl+J')).toEqual({ ok: true }); expect(listShortcuts().find((s) => s.id === 'b')!.keys).toBe('ctrl+j'); expect(remapShortcut('nope', 'x').ok).toBe(false); });
  it('the key runs its action, not while typing in a field, and ? opens the list with every shortcut', () => {
    const f = vi.fn(); registerShortcut({ id: 'home', keys: 'g', labelKey: 'nav.home', scope: 'global', handler: f }); registerShortcut({ id: 'menu', keys: 'm', labelKey: 'nav.menu', scope: 'global', handler: () => undefined }); render(<ShortcutHost><input aria-label="field" /></ShortcutHost>);
    fireEvent.keyDown(document.body, { key: 'g' }); expect(f).toHaveBeenCalledTimes(1); fireEvent.keyDown(screen.getByLabelText('field'), { key: 'g' }); expect(f).toHaveBeenCalledTimes(1); expect(remapShortcut('home', 'x').ok).toBe(true); fireEvent.keyDown(document.body, { key: 'g' }); expect(f).toHaveBeenCalledTimes(1); fireEvent.keyDown(document.body, { key: 'x' }); expect(f).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document.body, { key: '?' }); const dlg = screen.getByRole('dialog', { name: 'Keyboard shortcuts' }); expect(dlg.textContent).toContain('Home'); expect(dlg.textContent).toContain('Menu'); expect(dlg.textContent).toContain('x');
  });
  it('an unregistered shortcut does nothing', () => { const f = vi.fn(); const off = registerShortcut({ id: 'a', keys: 'g', labelKey: 'nav.home', scope: 'global', handler: f }); off(); render(<ShortcutHost />); fireEvent.keyDown(document.body, { key: 'g' }); expect(f).not.toHaveBeenCalled(); });
});
