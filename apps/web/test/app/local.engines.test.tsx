// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { EngineTabs } from '../../src/local/EngineTabs.js';
import { emptyView, installedEngines, isShown, reduceLocal } from '../../src/local/model.js';

afterEach(cleanup);
const st = { installed: true, version: '1', signedIn: 'yes' as const, kind: 'subscription' as never };
const launcher = (o: { claude?: boolean; codex?: boolean } = {}) => ({ t: 'launcher' as const, home: '/h', cwd: '/h/p', recent: [], claude: { ...st, installed: o.claude ?? true }, codex: { ...st, installed: o.codex ?? true }, prefs: { theme: 'auto' as const, side: true, engine: 'claude-code' as const } });
const viewOf = (o: { claude?: boolean; codex?: boolean; engine?: 'claude-code' | 'codex'; demo?: boolean } = {}) => {
  let v = reduceLocal(emptyView(), launcher(o)); v = reduceLocal(v, { t: 'opened', dir: '/h/p', history: [], engine: o.engine ?? 'claude-code', demo: o.demo ?? false });
  return reduceLocal(v, { t: 'running', sessions: [{ dir: '/h/p', engine: 'claude-code', demo: false, busy: true, waiting: 0 }] });
};

describe('the Claude Code / Codex tabs', () => {
  it('shows one tab per installed agent, marks the open one and switches with an open message', () => {
    const sent: unknown[] = []; render(<EngineTabs view={viewOf()} send={(m) => sent.push(m)} />);
    const tabs = screen.getAllByRole('tab'); expect(tabs.map((t) => t.textContent)).toEqual(['Claude Code', 'Codex']);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true'); expect(tabs[1]!.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(tabs[0]!); expect(sent).toEqual([]);
    fireEvent.click(tabs[1]!); expect(sent).toEqual([{ t: 'open', dir: '/h/p', engine: 'codex' }]);
  });
  it('is not there with one agent installed, or in the demo', () => {
    const a = render(<EngineTabs view={viewOf({ codex: false })} send={() => undefined} />); expect(a.container.textContent).toBe(''); a.unmount();
    const b = render(<EngineTabs view={viewOf({ demo: true })} send={() => undefined} />); expect(b.container.textContent).toBe('');
  });
  it('knows which of two sessions in one folder is shown', () => {
    const v = viewOf({ engine: 'codex' }); const claude = { dir: '/h/p', engine: 'claude-code' as const, demo: false, busy: false, waiting: 0 };
    expect(isShown(claude, v)).toBe(false); expect(isShown({ ...claude, engine: 'codex' }, v)).toBe(true);
    expect(installedEngines(v.launcher)).toEqual(['claude-code', 'codex']);
  });
  it('disables a tab for an agent that is not signed in', async () => {
    const v = reduceLocal(viewOf(), { ...launcher(), codex: { ...st, signedIn: 'no' as const } });
    render(<EngineTabs view={v} send={() => undefined} />); await waitFor(() => expect((screen.getByRole('tab', { name: /Codex/ }) as HTMLButtonElement).disabled).toBe(true));
  });
});
