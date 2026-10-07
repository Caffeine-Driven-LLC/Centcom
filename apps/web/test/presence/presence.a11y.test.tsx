// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../shell/src/a11y/index.js';
import { JoinAnnouncer, PresenceAvatar, PresenceStack, RosterDialog } from '../../shell/src/presence/components.js';
import type { Member } from '../../shell/src/presence/roster.js';
import type { Status } from '../../shell/src/presence/slots.js';

afterEach(cleanup);
const m = (id: string, name: string, slot: number, role: Member['role'] = 'editor'): Member => ({ id, name, slot, role, connected: true });
const people = [m('me', 'Me', 0, 'host'), m('a', 'Maya', 3), m('b', 'Ben', 1, 'viewer'), m('c', 'Cy', 2), m('d', 'Di', 4), m('e', 'Ed', 5), m('f', 'Fay', 6)];
const st = (id: string): Status => (id === 'b' ? 'away' : id === 'c' ? 'offline' : id === 'd' ? 'busy' : 'online');
describe('stack and dialog (acceptance 1, 5, 6)', () => {
  it('five avatars and +N, an accessible name with the count online, and a name and status on every avatar', () => { render(<PresenceStack members={people} me="me" status={st} onOpen={() => undefined} />); expect(screen.getByRole('button', { name: 'Participants, 6 online' })).toBeTruthy(); expect(screen.getAllByRole('img')).toHaveLength(5); expect(screen.getByText('+2')).toBeTruthy(); expect(screen.getByRole('img', { name: 'Ben, away' })).toBeTruthy(); expect(screen.getByRole('img', { name: 'Maya, online' })).toBeTruthy(); });
  it('the colour is set by slot and the glyph by status, so the dot is never colour alone', () => { render(<><PresenceAvatar member={people[1]!} selfSlot={0} status="online" /><PresenceAvatar member={people[5]!} selfSlot={0} status="busy" /></>); const [g, v] = screen.getAllByRole('img'); expect(g!.getAttribute('data-colour')).toBe('green'); expect(v!.getAttribute('data-colour')).toBe('violet-outlined'); expect(g!.textContent).toBe('M✓'); expect(v!.textContent).toBe('E−'); });
  const Host = () => { const [open, setOpen] = useState(false); return <><button type="button" onClick={() => setOpen(true)}>who</button><RosterDialog open={open} onClose={() => setOpen(false)} members={people} me="me" status={st} activity={() => 'typing'} since={() => 0} onNudge={() => undefined} nudgeAllowed={(id) => id !== 'a'} now={4 * 60_000} /></>; };
  it('a dialog with every name, role, colour word and activity; focus stays inside; Esc closes; focus goes back', async () => {
    render(<Host />); const b = screen.getByText('who'); b.focus(); fireEvent.click(b); const dlg = screen.getByRole('dialog', { name: 'Participants' }); expect(dlg.textContent).toContain('M · Maya · green'); expect(dlg.textContent).toContain('HOST'); expect(dlg.textContent).toContain('VIEW'); expect(dlg.textContent).toContain('E · Ed · violet outline'); expect(dlg.textContent).toContain('away 4m'); await expectNoA11yViolations(document.body);
    const close = screen.getByText('Close'); close.focus(); fireEvent.keyDown(close, { key: 'Tab' }); expect(dlg.contains(document.activeElement)).toBe(true); expect(screen.getAllByText('Nudge')[0]!.getAttribute('aria-disabled')).toBe('true'); fireEvent.keyDown(dlg.parentElement!, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(b);
  });
});
describe('announcements (acceptance 7)', () => {
  it('"Maya joined" is read politely and goes after 4 s', () => { vi.useFakeTimers(); try { const { rerender } = render(<JoinAnnouncer events={[{ id: 1, text: 'Maya joined' }]} />); const live = screen.getByRole('status'); expect(document.querySelectorAll('[role="status"]')).toHaveLength(1); expect(live.getAttribute('aria-live')).toBe('polite'); expect(live.textContent).toContain('Maya joined'); act(() => { vi.advanceTimersByTime(3999); }); expect(live.textContent).toContain('Maya joined'); act(() => { vi.advanceTimersByTime(1); }); expect(live.textContent).not.toContain('Maya joined'); rerender(<JoinAnnouncer events={[{ id: 1, text: 'Maya joined' }, { id: 2, text: 'Ben left' }]} />); expect(live.textContent).toContain('Ben left'); } finally { vi.useRealTimers(); } });
});
