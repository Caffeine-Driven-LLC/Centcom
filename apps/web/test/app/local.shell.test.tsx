// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { CommandPalette, filterEntries, type Entry } from '../../src/local/CommandPalette.js';
import { SessionPanel } from '../../src/local/SessionPanel.js';
import { SessionSidebar } from '../../src/local/Sidebar.js';
import { LocalProvider } from '../../src/local/use-local.js';
import { emptyView } from '../../src/local/model.js';

afterEach(() => { cleanup(); delete (window as { centcom?: unknown }).centcom; });
const st = { installed: true, version: '1.0', signedIn: 'yes' as const, kind: 'subscription' as never };
const launcher = { t: 'launcher' as const, home: '/h', cwd: '/h/p', recent: [{ dir: '/h/p', at: 1 }, { dir: '/h/q', at: 0 }], claude: st, codex: { ...st, installed: false }, prefs: { theme: 'auto' as const, side: true, engine: 'claude-code' as const } };
const state = (o: Record<string, unknown> = {}) => ({ busy: false, verb: '', branch: 'main', engineLabel: 'Claude Code', demo: false, sessionId: 'cur', approvals: [], agents: [], tasks: [], limits: [], settings: { permissionMode: 'default' }, sessions: [{ id: 'cur', title: 'This one', updatedAt: 1, messages: 2 }, { id: 'old', title: 'Yesterday fix', updatedAt: 1, messages: 9 }], ...o });

/** The component under a router, with a fake desktop bridge whose messages the test pushes. */
async function mount(ui: React.ReactNode): Promise<{ sent: { t: string; [k: string]: unknown }[]; push(m: unknown): Promise<void> }> {
  const sent: { t: string; [k: string]: unknown }[] = []; let cb: (m: unknown) => void = () => undefined;
  const bridge = { send: (m: { t: string }) => sent.push(m), onMessage: (f: (m: unknown) => void) => { cb = f; return () => undefined; } };
  const root = createRootRoute({ component: () => <LocalProvider bridge={bridge}>{ui}</LocalProvider> });
  const router = createRouter({ routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: '/local', component: () => null })]), history: createMemoryHistory({ initialEntries: ['/'] }) });
  await act(async () => { render(<RouterProvider router={router} />); });
  await waitFor(() => expect(sent[0]).toEqual({ t: 'hello' }));
  return { sent, push: async (m) => { await act(async () => cb(m)); } };
}

describe('palette search', () => {
  const e = (id: string, label: string, group = 'Session', keywords = ''): Entry => ({ id, label, group, keywords, icon: (() => null) as never, run: () => undefined });
  it('keeps entries that contain every word, in order, and matches the group and keywords too', () => {
    const all = [e('a', 'New session'), e('b', 'Compact the conversation'), e('c', 'Dark theme', 'Appearance', 'night')];
    expect(filterEntries(all, '').map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(filterEntries(all, 'SESS new').map((x) => x.id)).toEqual(['a']);
    expect(filterEntries(all, 'appearance').map((x) => x.id)).toEqual(['c']); expect(filterEntries(all, 'night')[0]!.id).toBe('c'); expect(filterEntries(all, 'zzz')).toEqual([]);
  });
});
describe('the palette', () => {
  it('lists projects and saved sessions, filters as you type, and Enter runs the first match', async () => {
    const { sent, push } = await mount(<CommandPalette open onOpenChange={() => undefined} nav={[{ id: 'settings', labelKey: 'nav.settings', to: '/settings', icon: 'x' }]} />);
    await push(launcher); await push({ t: 'opened', dir: '/h/p', history: [] }); await push({ t: 'state', state: state(), changed: [], order: [] });
    expect(screen.getByText('Yesterday fix')).toBeTruthy(); expect(screen.queryByText('This one')).toBeNull(); expect(screen.getByText('q')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search commands, projects and sessions'), { target: { value: 'yesterday' } });
    expect(screen.queryByText('Compact the conversation')).toBeNull();
    fireEvent.keyDown(screen.getByLabelText('Search commands, projects and sessions'), { key: 'Enter' });
    expect(sent.at(-1)).toEqual({ t: 'open', dir: '/h/p', engine: 'claude-code', demo: false, resume: 'old' });
  });
  it('says so when nothing matches', async () => {
    const { push } = await mount(<CommandPalette open onOpenChange={() => undefined} nav={[]} />); await push(launcher);
    fireEvent.change(screen.getByLabelText('Search commands, projects and sessions'), { target: { value: 'qqqq' } }); expect(screen.getByText('Nothing matches.')).toBeTruthy();
  });
  it('shows the keyboard shortcuts', async () => {
    const { push } = await mount(<CommandPalette open onOpenChange={() => undefined} nav={[]} />); await push(launcher);
    fireEvent.change(screen.getByLabelText('Search commands, projects and sessions'), { target: { value: 'shortcuts' } }); fireEvent.keyDown(screen.getByLabelText('Search commands, projects and sessions'), { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy(); expect(screen.getByText('Ctrl/Cmd+K')).toBeTruthy(); expect(screen.getByText('Stop the agent while it works')).toBeTruthy();
  });
  it('Esc closes it', async () => {
    let open = true; await mount(<CommandPalette open onOpenChange={(o) => { open = o; }} nav={[]} />);
    fireEvent.keyDown(window, { key: 'Escape' }); expect(open).toBe(false);
  });
});
describe('the sidebar', () => {
  it('shows the live session with its state, saved sessions and the other projects; a click resumes or opens', async () => {
    const { sent, push } = await mount(<SessionSidebar onNavigate={() => undefined} onSearch={() => undefined} />);
    await push(launcher); await push({ t: 'opened', dir: '/h/p', history: [] }); await push({ t: 'state', state: state({ busy: true }), changed: [], order: [] });
    expect(screen.getByText('Running')).toBeTruthy(); expect(screen.getByText('working')).toBeTruthy();
    fireEvent.click(screen.getByText('Yesterday fix')); expect(sent.at(-1)).toEqual({ t: 'open', dir: '/h/p', engine: 'claude-code', demo: false, resume: 'old' });
    fireEvent.click(screen.getByText('q')); expect(sent.at(-1)).toEqual({ t: 'open', dir: '/h/q', engine: 'claude-code', demo: false });
    fireEvent.click(screen.getByText('New session')); expect(sent.at(-1)).toEqual({ t: 'leave' });
  });
});
describe('running sessions', () => {
  it('lists every live session with its state; a click on another one switches to it', async () => {
    const { sent, push } = await mount(<SessionSidebar onNavigate={() => undefined} onSearch={() => undefined} />);
    await push(launcher); await push({ t: 'opened', dir: '/h/p', history: [] }); await push({ t: 'state', state: state(), changed: [], order: [] });
    await push({ t: 'running', sessions: [{ dir: '/h/p', engine: 'claude-code', demo: false, busy: false, waiting: 0 }, { dir: '/h/q', engine: 'codex', demo: false, busy: false, waiting: 1, ask: 'run ls' }] });
    expect(screen.getByText('needs you')).toBeTruthy(); expect(screen.getAllByText('ready').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('needs you')); expect(sent.at(-1)).toEqual({ t: 'open', dir: '/h/q', engine: 'codex', demo: false });
  });
  it('the palette offers the other running sessions', async () => {
    const { sent, push } = await mount(<CommandPalette open onOpenChange={() => undefined} nav={[]} />);
    await push(launcher); await push({ t: 'opened', dir: '/h/p', history: [] }); await push({ t: 'state', state: state(), changed: [], order: [] });
    await push({ t: 'running', sessions: [{ dir: '/h/p', engine: 'claude-code', demo: false, busy: false, waiting: 0 }, { dir: '/h/q', engine: 'codex', demo: false, busy: true, waiting: 0 }] });
    expect(screen.getByText('Running sessions')).toBeTruthy(); fireEvent.click(screen.getByText('working'));
    expect(sent.at(-1)).toEqual({ t: 'open', dir: '/h/q', engine: 'codex', demo: false });
  });
});
describe('shared notes', () => {
  const note = (o: Record<string, unknown> = {}) => ({ id: 'n1', type: 'warning', text: 'The CI cache is stale', author: 'Agent 2', person: false, pinned: false, ts: 1, files: [], ...o });
  const withBoard = (enabled: boolean, notes: unknown[]) => ({ ...emptyView(), opened: '/h/p', state: state(), board: { enabled, notes } }) as never;
  it('is not shown when the board is off', () => { render(<SessionPanel view={withBoard(false, [])} send={() => undefined} />); expect(screen.queryByText('Shared notes')).toBeNull(); });
  it('lists the notes with who wrote them; pin and remove send the right messages', () => {
    const sent: unknown[] = []; render(<SessionPanel view={withBoard(true, [note(), note({ id: 'n2', type: 'decision', text: 'Use pnpm', author: 'you', person: true, pinned: true })])} send={(m) => sent.push(m)} />);
    expect(screen.getByText('The CI cache is stale')).toBeTruthy(); expect(screen.getByText('Agent 2')).toBeTruthy(); expect(screen.getByText('Use pnpm')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Pin: The CI cache is stale')); fireEvent.click(screen.getByLabelText('Unpin: Use pnpm')); fireEvent.click(screen.getByLabelText('Remove: Use pnpm'));
    expect(sent).toEqual([{ t: 'notePin', id: 'n1', pinned: true }, { t: 'notePin', id: 'n2', pinned: false }, { t: 'noteRemove', id: 'n2' }]);
  });
  it('adds a note of the chosen kind and clears the box', () => {
    const sent: unknown[] = []; render(<SessionPanel view={withBoard(true, [])} send={(m) => sent.push(m)} />);
    expect(screen.getByText(/Nothing yet/)).toBeTruthy(); expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Note for every agent'), { target: { value: '  Do not touch src/legacy ' } }); fireEvent.change(screen.getByLabelText('Kind of note'), { target: { value: 'warning' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' })); expect(sent).toEqual([{ t: 'note', type: 'warning', text: 'Do not touch src/legacy' }]); expect((screen.getByLabelText('Note for every agent') as HTMLInputElement).value).toBe('');
  });
});
describe('Ctrl+N', () => {
  it('the sidebar hands the frame a new-session action that leaves the project (its agent keeps running)', async () => {
    const ref: React.MutableRefObject<(() => void) | null> = { current: null };
    const { sent, push } = await mount(<SessionSidebar onNavigate={() => undefined} onSearch={() => undefined} newSession={ref} />);
    await push(launcher); await waitFor(() => expect(ref.current).not.toBeNull());
    await act(async () => { ref.current!(); }); expect(sent.at(-1)).toEqual({ t: 'leave' });
  });
});
describe('the session panel', () => {
  const view = (o: Record<string, unknown> = {}, items: unknown[] = []) => ({ ...emptyView(), opened: '/h/p', items, state: state(o) }) as never;
  const edit = { kind: 'tool', id: 'e', toolId: 'e', agentId: 'a', name: 'Edit', summary: '', risk: 'low', status: 'ok', startedAt: 0, path: '/h/p/src/a.ts', diff: '@@ -1,1 +1,1 @@\n-old line\n+new line' };
  it('shows status, the plan, who is in the session and the files changed', () => {
    render(<SessionPanel view={view({ approvals: [{ id: 'x' }], tasks: [{ id: '1', text: 'Write tests', status: 'in_progress' }, { id: '2', text: 'Ship', status: 'pending' }], agents: [{ id: 'a', name: 'Cento', busy: true, state: 'streaming', model: 'm', engine: 'e', cost: 0.5, inTok: 1000, outTok: 500, ctxPct: 90 }] }, [edit, { kind: 'user', id: 'u', text: 'hi', ts: 0, member: { name: 'Ada', slot: 1 } }])} />);
    expect(screen.getByText('Needs you')).toBeTruthy(); expect(screen.getByText('Write tests')).toBeTruthy(); expect(screen.getByText('0/2')).toBeTruthy();
    expect(screen.getByText('Ada')).toBeTruthy(); expect(screen.getByText('You')).toBeTruthy(); expect(screen.getByText(/compact soon/)).toBeTruthy(); expect(screen.getByText('src/a.ts')).toBeTruthy();
  });
  it('opens a file\'s diff and goes back', () => {
    render(<SessionPanel view={view({}, [edit])} />);
    fireEvent.click(screen.getByText('src/a.ts')); expect(screen.getByText(/new line/)).toBeTruthy();
    fireEvent.click(screen.getByText('← All files')); expect(screen.queryByText(/new line/)).toBeNull();
  });
  it('says nothing changed yet, and that only you are here', () => {
    render(<SessionPanel view={view()} />); expect(screen.getByText(/Nothing changed yet in p/)).toBeTruthy(); expect(screen.getByText(/Only you so far/)).toBeTruthy();
  });
});
