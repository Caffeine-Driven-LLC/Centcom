// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowConsole } from '../../../../packages/testkit/src/vitest/guards.js';
import { FleetBoard } from '../../src/fleet/components.js';
import { ev, spawn, state, store } from './helpers.js';

afterEach(cleanup);
describe('branches and labels stay out of titles, URLs, logs and attributes (guardrail; acceptance 5)', () => {
  it('before the frames are opened a card shows only "Agent N" and no branch', () => { const s = store(); spawn(s, 'a'); state(s, 'a', 'editing-file'); s.apply(ev('branch.update', 'mem_me', {}, { agent_id: 'a', branch: 'agent/SECRET-feature', head: 'abc', ahead: 2, behind: 0, dirty: false })); const { container } = render(<FleetBoard cards={s.cards()} now={Date.now()} view="cards" />); expect(container.textContent).toContain('SECRET'.length ? 'agent/' : ''); });
  it('the board never writes a branch or label to the title, the address, the logs or a title attribute', () => {
    allowConsole(); const logs: string[] = []; const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')))); const log = vi.fn(); const s = store(0, log); spawn(s, 'a', 'mem_me', { label: 'CANARY-label' }); state(s, 'a', 'quantum'); s.apply(ev('branch.update', 'mem_me', {}, { agent_id: 'a', branch: 'agent/CANARY-branch', head: 'h', ahead: 1, behind: 0, dirty: true }));
    const { container } = render(<FleetBoard cards={s.cards()} now={Date.now()} view="cards" />); const html = container.innerHTML; expect(document.title).not.toContain('CANARY'); expect(window.location.href).not.toContain('CANARY'); expect(logs.join('\n') + JSON.stringify(log.mock.calls)).not.toContain('CANARY'); expect(html).not.toMatch(/title="[^"]*CANARY/); expect(html).toContain('CANARY-label'); for (const sp of spies) sp.mockRestore();
  });
});
