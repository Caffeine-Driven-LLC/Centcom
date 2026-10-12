// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { JoinedPane } from '../../src/local/JoinedPane.js';
import { JoinDialog, openJoin } from '../../src/local/JoinDialog.js';
import { emptyView, reduceLocal, type LocalView } from '../../src/local/model.js';
import type { ClientMsg, JoinedView } from '../../../desktop/src/local/protocol.js';

afterEach(cleanup);
const people = [{ id: 'm1', name: 'Alice', slot: 0, role: 'host' as const, you: false, online: true }, { id: 'm2', name: 'Bob', slot: 1, role: 'editor' as const, you: true, online: true }];
const j = (o: Partial<JoinedView> = {}): JoinedView => ({ state: 'live', sessionId: 'ses_1', how: 'invite', role: 'editor', people, entries: [{ id: 'e1', kind: 'user', text: 'fix the bug', who: 'Alice', slot: 0 }, { id: 'e2', kind: 'assistant', text: 'Done: **fixed**', done: true }, { id: 'e3', kind: 'tool', text: 'Edit: a.ts', status: 'ok' }], asked: [{ item: 'que_1', text: 'add a test', state: 'queued' }], ...o });
const withJoined = (v: JoinedView): LocalView => reduceLocal(emptyView(), { t: 'joined', joined: v });
function pane(v: JoinedView) { const sent: ClientMsg[] = []; render(<JoinedPane view={withJoined(v)} send={(m) => sent.push(m)} />); return sent; }

describe('somebody else\'s session', () => {
  it('shows the transcript, who is there and what you asked, and an editor asks with Enter', () => {
    const sent = pane(j()); expect(screen.getByText('fix the bug')).toBeTruthy(); expect(screen.getByText('fixed')).toBeTruthy(); expect(screen.getByText(/Waiting for the host: add a test/)).toBeTruthy(); expect(screen.getByText('can edit')).toBeTruthy();
    const box = screen.getByLabelText("Ask the host's agent"); fireEvent.change(box, { target: { value: ' add docs ' } }); fireEvent.keyDown(box, { key: 'Enter' }); expect(sent.at(-1)).toEqual({ t: 'joinedAsk', text: 'add docs' });
    fireEvent.click(screen.getByRole('button', { name: /Leave/ })); expect(sent.at(-1)).toEqual({ t: 'joinedLeave' });
  });
  it('a viewer can read but has no box; a failed join says why; an ended session says so', () => {
    pane(j({ role: 'viewer', asked: [] })); expect(screen.queryByLabelText("Ask the host's agent")).toBeNull(); expect(screen.getByText(/watch this session but not send/)).toBeTruthy(); cleanup();
    pane({ state: 'failed', people: [], entries: [], asked: [], error: 'That invite is no longer valid. Ask for a new one.' }); expect(screen.getByRole('alert').textContent).toMatch(/no longer valid/); cleanup();
    pane(j({ state: 'ended' })); expect(screen.getByRole('status').textContent).toMatch(/ended/);
  });
  it('the join dialog sends what was pasted', async () => {
    const sent: ClientMsg[] = []; render(<JoinDialog view={emptyView()} send={(m) => sent.push(m)} />); fireEvent(window, new Event('centcom:join')); void openJoin;
    const input = await screen.findByLabelText('Link or session id'); fireEvent.change(input, { target: { value: ' https://centcom.dev/i/abc ' } }); fireEvent.click(screen.getByRole('button', { name: /Join/ })); expect(sent.at(-1)).toEqual({ t: 'join', input: 'https://centcom.dev/i/abc' });
  });
});
