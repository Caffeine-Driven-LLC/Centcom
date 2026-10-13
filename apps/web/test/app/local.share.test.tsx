// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { ShareButton, ShareDialog } from '../../src/local/ShareDialog.js';
import { emptyView, reduceLocal, type LocalView } from '../../src/local/model.js';
import type { ClientMsg, SharingView } from '../../../desktop/src/local/protocol.js';

afterEach(cleanup);
const base = (): LocalView => reduceLocal(emptyView(), { t: 'opened', dir: '/h/p', history: [], engine: 'claude-code', demo: false });
const live: SharingView = { state: 'live', sessionId: 'ses_01ABC', name: 'p', workspace: 'alice', auto: false, members: [{ id: 'm1', name: 'Alice', slot: 0, role: 'host', online: true, you: true }, { id: 'm2', name: 'Bob', slot: 1, role: 'editor', online: true, you: false }], pending: [{ item: 'que_01X', from: 'Bob', slot: 1, text: 'add tests' }] };
function ui(view: LocalView) { const sent: ClientMsg[] = []; const r = render(<><ShareButton view={view} /><ShareDialog view={view} send={(m) => sent.push(m)} /></>); return { sent, r }; }
const open = async () => { await act(async () => { window.dispatchEvent(new Event('centcom:share')); }); };

describe('the share button and dialog', () => {
  it('offers Share, asks to sign in first when signed out, and starts sharing when signed in', async () => {
    const out = reduceLocal(base(), { t: 'account', account: { signedIn: false, persisted: true, api: 'http://x' } });
    const a = ui(out); await open(); expect(screen.getByText('Sharing needs an account.')).toBeTruthy(); expect(a.sent.some((m) => m.t === 'account')).toBe(true); cleanup();
    const inn = reduceLocal(base(), { t: 'account', account: { signedIn: true, persisted: true, api: 'http://x', me: { id: 'u', name: 'Alice', email: 'a@x.test', plan: 'team' } } }); const b = ui(inn); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Start sharing' })); expect(b.sent.at(-1)).toEqual({ t: 'share', mode: 'command_post' });
    fireEvent.click(screen.getByLabelText(/Everyone runs their own agent/)); fireEvent.click(screen.getByRole('button', { name: 'Start sharing' })); expect(b.sent.at(-1)).toEqual({ t: 'share', mode: 'branch' });
  });
  it('shows who is in a live session, lets the host decide what editors asked, make a link and stop', async () => {
    const v = reduceLocal(base(), { t: 'sharing', sharing: live }); const { sent } = ui(v); expect(screen.getByRole('button', { name: /Shared · 1/ })).toBeTruthy(); await open();
    expect(screen.getByText('ses_01ABC')).toBeTruthy(); expect(screen.getByText('can edit')).toBeTruthy(); expect(screen.getByText(/add tests/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run it' })); expect(sent.at(-1)).toEqual({ t: 'shareDecide', item: 'que_01X', decision: 'approve' });
    fireEvent.click(screen.getByRole('button', { name: 'No' })); expect(sent.at(-1)).toEqual({ t: 'shareDecide', item: 'que_01X', decision: 'reject' });
    fireEvent.click(screen.getByLabelText(/without asking me/)); expect(sent.at(-1)).toEqual({ t: 'shareAuto', on: true });
    fireEvent.click(screen.getByRole('button', { name: 'Make a link' })); expect(sent.at(-1)).toEqual({ t: 'shareLink' });
    fireEvent.change(screen.getByLabelText('E-mail address'), { target: { value: 'bob@x.test' } }); fireEvent.click(screen.getByRole('button', { name: 'Invite' })); expect(sent.at(-1)).toEqual({ t: 'shareInvite', email: 'bob@x.test' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' })); expect(sent.at(-1)).toEqual({ t: 'unshare' });
  });
  it('in a branch-mode session it says so, and lets the person stop showing what their agent says and does', async () => {
    const v = reduceLocal(base(), { t: 'sharing', sharing: { ...live, mode: 'branch', activity: true } }); const { sent } = ui(v); await open();
    expect(screen.getByText('Everyone runs their own agent')).toBeTruthy(); fireEvent.click(screen.getByLabelText(/Show the team what my agent says/)); expect(sent.at(-1)).toEqual({ t: 'shareActivity', on: false });
  });
  it('says so when branch mode was asked for and the server did not offer it', async () => {
    const v = reduceLocal(base(), { t: 'sharing', sharing: { ...live, mode: 'command_post', degraded: true, hint: 'This server does not support "everyone runs their own agent" yet, so the session works as a command post.' } }); ui(v); await open();
    expect(screen.getByText(/does not support "everyone runs their own agent" yet/)).toBeTruthy();
  });
  it('says why sharing failed (a plan without the relay) and has no button in the demo', async () => {
    const v = reduceLocal(base(), { t: 'sharing', sharing: { state: 'failed', name: 'p', auto: false, members: [], pending: [], code: 'entitlement_required', error: 'Your plan does not include sharing over the internet. Upgrade to Pro or Team to share a session.' } }); ui(v); await open();
    expect(screen.getByRole('alert').textContent).toMatch(/Upgrade to Pro or Team/); cleanup();
    const demo = reduceLocal(reduceLocal(base(), { t: 'state', state: { demo: true } as never, changed: [], order: [] }), { t: 'sharing', sharing: null }); const d = ui(demo); expect(d.r.container.textContent).toBe('');
  });
});
