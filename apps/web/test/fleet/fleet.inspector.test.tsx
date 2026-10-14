// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../src/a11y/index.js';
import { AgentInspector, FleetBoard } from '../../src/fleet/components.js';
import { ev, spawn, state, store } from './helpers.js';

afterEach(cleanup);
const withBranch = () => { const s = store(0); spawn(s, 'agt_a', 'mem_me', { label: 'fix-login' }); state(s, 'agt_a', 'awaiting-approval'); s.apply(ev('branch.update', 'mem_me', {}, { agent_id: 'agt_a', branch: 'agent/fix-login-with-a-very-long-descriptive-name', head: 'h', ahead: 3, behind: 1, dirty: true })); return s.cards()[0]!; };
describe('the agent inspector (C084)', () => {
  it('shows the whole card in words: owner, state, the full branch, ahead and behind, files held, conflict; it is a named complementary region and passes the structural check', async () => {
    const c = withBranch(); const { container } = render(<AgentInspector card={c} now={Date.UTC(2026, 9, 7, 12, 1)} onClose={() => undefined} />); const r = screen.getByRole('complementary', { name: 'Details of fix-login' });
    expect(within(r).getByText('agent/fix-login-with-a-very-long-descriptive-name')).toBeTruthy(); expect(r.textContent).toMatch(/3 ahead, 1 behind, changes not saved/); expect(r.textContent).toContain('Needs you'); expect(r.textContent).toMatch(/Files held.*none/); await expectNoA11yViolations(container);
  });
  it('Enter on a card opens it, focus moves into the panel, Esc and Close call onClose, and merge actions go out through the callback only for your own branch with work on it', () => {
    const c = withBranch(); const open = vi.fn(); render(<FleetBoard cards={[c]} now={0} view="cards" onOpen={open} />); fireEvent.keyDown(screen.getByRole('article'), { key: 'Enter' }); expect(open).toHaveBeenCalledWith('agt_a');
    const close = vi.fn(); const merge = vi.fn(); cleanup(); render(<AgentInspector card={c} now={0} onClose={close} onMerge={merge} />); expect(document.activeElement).toBe(screen.getByRole('complementary'));
    fireEvent.click(screen.getByRole('button', { name: 'Rebase' })); expect(merge).toHaveBeenCalledWith('agt_a', 'rebase'); fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' }); expect(close).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('button', { name: 'Close' })); expect(close).toHaveBeenCalledTimes(2);
    cleanup(); render(<AgentInspector card={{ ...c, mine: false }} now={0} onClose={close} />); expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull();
  });
});
