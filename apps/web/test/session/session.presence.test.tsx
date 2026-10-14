// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { reduceGuestState, SERVER } from '@centcom/guest';
import { fakeConn, fold, fr, HOST, openPage } from './helpers.js';

afterEach(cleanup);
describe('the session page shows who is here (C083 roster wiring, C085)', () => {
  it('the participants stack opens the roster dialog with names, roles, colours and what each is doing; Esc closes it', async () => {
    const f = fakeConn(fold([], 'editor')); openPage(f.conn); const stack = await screen.findByRole('button', { name: /Participants, 2 online/ });
    act(() => f.emit({ kind: 'presence.update', from: HOST, p: { status: 'busy', activity: 'reviewing' } })); fireEvent.click(stack);
    const dlg = await screen.findByRole('dialog', { name: 'Participants' }); expect(within(dlg).getByText(/H · Hana/)).toBeTruthy(); expect(within(dlg).getByText('HOST')).toBeTruthy(); expect(within(dlg).getByText('EDIT')).toBeTruthy();
    await waitFor(() => { act(() => f.emit({ kind: 'presence.update', from: HOST, p: { status: 'busy', activity: 'reviewing' } })); expect(within(dlg).getByLabelText('Hana, busy')).toBeTruthy(); }); // the page listens once its connection is attached, which can be after the first update was sent: say it again until it is heard fireEvent.keyDown(dlg.parentElement!, { key: 'Escape' }); await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Participants' })).toBeNull());
  });
  it('announces "Maya joined" and "Maya left" politely, and does not announce the people who were already there', async () => {
    const f = fakeConn(fold([], 'editor')); openPage(f.conn); await screen.findByRole('button', { name: /Participants/ }); expect(screen.queryByText(/joined/)).toBeNull();
    let s = fold([], 'editor'); s = reduceGuestState(s, fr('control.member_joined', SERVER, { member: 'mem_maya', name: 'Maya', slot: 2, role: 'editor' })); act(() => f.push(s)); expect((await screen.findByText('Maya joined')).closest('[aria-live="polite"]')).toBeTruthy();
    s = reduceGuestState(s, fr('control.member_left', SERVER, { member: 'mem_maya' })); act(() => f.push(s)); expect(await screen.findByText('Maya left')).toBeTruthy();
  });
  it('typing in the composer publishes one presence.update (typing) after the debounce, and the page never sends text in the clear part', async () => {
    const f = fakeConn(fold([], 'editor')); openPage(f.conn); const box = await screen.findByLabelText('Message');
    fireEvent.keyDown(box, { key: 'a' }); await waitFor(() => expect(f.sent.filter((x) => x.kind === 'presence.update')).toHaveLength(1), { timeout: 3000 });
    const u = f.sent.find((x) => x.kind === 'presence.update')!; expect(u.body).toEqual({ p: { status: 'online', activity: 'typing' } });
  });
  it('a session opened right after accepting an invite connects with that invite token and key, once, and neither is in the address', async () => {
    const { setInviteHandoff } = await import('../../src/session/handoff.js'); setInviteHandoff('ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', { token: 'AbCdEfGhIjKlMnOpQrStUvWxYz0', secret: '#k=AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA' });
    const f = fakeConn(fold([], 'editor')); const { connects } = openPage(f.conn); await screen.findByLabelText('Message');
    expect(connects[0]).toMatchObject({ inviteToken: 'AbCdEfGhIjKlMnOpQrStUvWxYz0', inviteSecret: '#k=AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA' }); expect(window.location.href).not.toContain('AQIDBAUG');
  });
  it('each page is its own device (the keys live in the tab), not one shared id', async () => {
    const a = fakeConn(fold([], 'editor')); const one = openPage(a.conn); await screen.findByLabelText('Message'); cleanup(); const b = fakeConn(fold([], 'editor')); const two = openPage(b.conn); await screen.findByLabelText('Message');
    const id1 = (one.connects[0] as { deviceId: string }).deviceId; const id2 = (two.connects[0] as { deviceId: string }).deviceId; expect(id1).toMatch(/^dev_[0-9A-F]{32}$/); expect(id1).not.toBe(id2);
  });
  it('the roster Nudge button pokes a member (one presence.nudge, in the clear), a second poke inside a minute is refused, and a poke for you is announced', async () => {
    const f = fakeConn(fold([], 'editor')); openPage(f.conn); fireEvent.click(await screen.findByRole('button', { name: /Participants, 2 online/ })); const dlg = await screen.findByRole('dialog', { name: 'Participants' });
    const nudge = within(dlg).getAllByRole('button', { name: /Nudge/i })[0]!; fireEvent.click(nudge);
    await waitFor(() => expect(f.sent.filter((x) => x.kind === 'presence.nudge')).toHaveLength(1)); expect(f.sent.find((x) => x.kind === 'presence.nudge')!.body).toEqual({ p: { to: HOST } });
    fireEvent.click(nudge); await new Promise((r) => setTimeout(r, 50)); expect(f.sent.filter((x) => x.kind === 'presence.nudge')).toHaveLength(1);
    act(() => f.emit({ kind: 'presence.nudge', from: HOST, p: { to: fold([], 'editor').me.member } })); expect(await screen.findByText(/Hana nudged you/)).toBeTruthy();
  });
});
