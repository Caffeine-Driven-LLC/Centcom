// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { TeamSection } from '../../src/local/TeamSection.js';
import { emptyView, reduceLocal, type LocalView } from '../../src/local/model.js';
import type { ClientMsg, SharingView } from '../../../desktop/src/local/protocol.js';

afterEach(cleanup);
const team = { members: [
  { id: 'm1', name: 'Me', role: 'host', slot: 0, online: true, you: true, agents: [{ id: 'agt_1', owner: 'm1', mode: 'branch', provider: 'anthropic', state: 'idle', since: 'x', branch: 'me/ui', ahead: 1, behind: 0, dirty: false, locks: [{ hmac: 'h', path: 'src/db.ts', until: 1 }], sharing: true }] },
  { id: 'm2', name: 'Ana', role: 'editor', slot: 1, online: true, you: false, agents: [{ id: 'agt_2', owner: 'm2', mode: 'branch', provider: 'openai', state: 'awaiting-approval', since: 'x', branch: 'ana/db', ahead: 2, behind: 12, dirty: true, locks: [], lastSaid: 'Ana: add a migration', sharing: true }] },
], conflicts: [{ id: 'c', agents: ['agt_1', 'agt_2'], hmacs: ['h'], paths: ['src/db.ts'], at: 'x' }], handoffs: [{ id: 'h1', from: 'm2', to: 'm1', agent: 'agt_2', note: 'finish the tests', state: 'offered' as const, at: 'x' }], hints: ['Ana\'s agent is 12 commits behind: merge soon.'] };
const sharing = (o: Partial<SharingView> = {}): SharingView => ({ state: 'live', name: 'p', mode: 'branch', auto: false, members: [], pending: [], team, ...o } as SharingView);
const ui = (sh: SharingView | null) => { const sent: ClientMsg[] = []; const v: LocalView = reduceLocal(reduceLocal(emptyView(), { t: 'opened', dir: '/h/p', history: [] }), { t: 'sharing', sharing: sh }); const r = render(<TeamSection view={v} send={(m) => sent.push(m)} />); return { sent, r }; };

describe('the team section of the session panel', () => {
  it('shows each person with their agents: who, state, branch, files open, what they last said, and the conflict', () => {
    ui(sharing()); expect(screen.getByText('Claude Code')).toBeTruthy(); expect(screen.getByText('Codex')).toBeTruthy(); expect(screen.getByText('waiting for its owner')).toBeTruthy();
    expect(screen.getByText(/ana\/db · 2 ahead, 12 behind, changes/)).toBeTruthy(); expect(screen.getByText('Ana: add a migration')).toBeTruthy(); expect(screen.getAllByText(/src\/db\.ts/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('alert').textContent).toMatch(/Two agents are changing src\/db\.ts/); expect(screen.getByText(/12 commits behind: merge soon/)).toBeTruthy();
  });
  it('answers a handoff offered to you, and offers your work to someone', () => {
    const { sent } = ui(sharing()); expect(screen.getByText(/Ana offers you their work: finish the tests/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' })); expect(sent.at(-1)).toEqual({ t: 'shareHandoffAnswer', id: 'h1', accept: true });
    fireEvent.click(screen.getByRole('button', { name: 'Decline' })); expect(sent.at(-1)).toEqual({ t: 'shareHandoffAnswer', id: 'h1', accept: false });
    fireEvent.click(screen.getByText('Hand my work to someone')); fireEvent.click(screen.getByRole('button', { name: 'Ana' })); expect(sent.at(-1)).toEqual({ t: 'shareHandoff', to: 'm2' });
  });
  it('is not there in a command post or when nothing is shared', () => { const a = ui(sharing({ mode: 'command_post' })); expect(a.r.container.textContent).toBe(''); cleanup(); const b = ui(null); expect(b.r.container.textContent).toBe(''); });
});
