// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { Markdown, parseBlocks } from '../../src/local/Markdown.js';
import { Diff, parseDiff } from '../../src/local/Diff.js';
import { LocalPage, whenAgo } from '../../src/local/routes.js';
import { CentoMark } from '../../src/ui/index.js';

afterEach(() => { cleanup(); delete (window as { centcom?: unknown }).centcom; });

describe('answers are rendered as Markdown, safely', () => {
  it('paragraphs, lists, headings, fenced code, inline code and emphasis', () => {
    const b = parseBlocks('# Title\n\nFirst **bold** and `code`.\nStill the same paragraph.\n\n- one\n- two\n\n1. a\n2. b\n\n```ts\nconst a = 1;\n```\n');
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'ul', 'ol', 'code']); expect(b[1]).toMatchObject({ text: 'First **bold** and `code`. Still the same paragraph.' }); expect(b[4]).toMatchObject({ lang: 'ts', text: 'const a = 1;' });
    const { container } = render(<Markdown text={'Found `expiresAt` in **seconds** and *ms*.\n\n- a\n- b'} />);
    expect(container.querySelectorAll('code.lc-code')).toHaveLength(1); expect(container.querySelector('strong')?.textContent).toBe('seconds'); expect(container.querySelector('em')?.textContent).toBe('ms'); expect(container.querySelectorAll('li')).toHaveLength(2);
  });
  it('never inserts HTML and never makes anything clickable; an unclosed fence still ends', () => {
    const { container } = render(<Markdown text={'<img src=x onerror=alert(1)> <script>alert(2)</script> [click](javascript:alert(3))\n\n```\nunclosed'} />);
    expect(container.querySelector('img')).toBeNull(); expect(container.querySelector('script')).toBeNull(); expect(container.querySelector('a')).toBeNull(); expect(container.textContent).toContain('<img src=x onerror=alert(1)>'); expect(container.textContent).toContain('click'); expect(container.textContent).not.toContain('javascript:');
    expect(container.querySelector('pre')?.textContent).toBe('unclosed');
  });
});

describe('a diff', () => {
  const d = '--- a/f.ts\n+++ b/f.ts\n@@ -39,3 +39,4 @@\n keep\n-old\n+new\n+newer\n tail';
  it('has line numbers from the hunk header; the sign stays in the text (colour is not the only cue)', () => {
    const rows = parseDiff(d); expect(rows.map((r) => r.kind)).toEqual(['file', 'file', 'hunk', 'ctx', 'del', 'add', 'add', 'ctx']); expect(rows[3]).toMatchObject({ old: 39, now: 39 }); expect(rows[4]).toMatchObject({ old: 40 }); expect(rows[5]).toMatchObject({ now: 40 }); expect(rows[6]).toMatchObject({ now: 41 });
    const { container } = render(<Diff diff={d} />); expect(container.querySelector('figure')?.getAttribute('aria-label')).toBe('Change: 2 added, 1 removed'); expect(container.querySelectorAll('.lc-diff__row--add')).toHaveLength(2); expect(container.querySelector('.lc-diff__row--del .lc-diff__text')?.textContent).toBe('-old');
  });
  it('long ones are cut with a count', () => {
    const long = '@@ -1,40 +1,40 @@\n' + Array.from({ length: 40 }, (_, i) => `+line ${i}`).join('\n'); const { container } = render(<Diff diff={long} max={10} />); expect(container.querySelectorAll('.lc-diff__row')).toHaveLength(10); expect(container.textContent).toContain('31 more lines');
  });
});

describe('small helpers', () => {
  it('whenAgo reads naturally', () => { const now = 1_000_000_000_000; expect(whenAgo(now - 20_000, now)).toBe('just now'); expect(whenAgo(now - 5 * 60_000, now)).toBe('5 min ago'); expect(whenAgo(now - 3 * 3600_000, now)).toBe('3 h ago'); expect(whenAgo(now - 86400_000, now)).toBe('1 day ago'); expect(whenAgo(now - 4 * 86400_000, now)).toBe('4 days ago'); });
  it('the Cento mark is decorative and made of tokens, not colours', () => { const { container } = render(<CentoMark size={32} />); const svg = container.querySelector('svg')!; expect(svg.getAttribute('aria-hidden')).toBe('true'); expect(svg.getAttribute('width')).toBe('32'); expect(container.querySelectorAll('rect').length).toBeGreaterThan(60); expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/); });
});

describe('the session view', () => {
  async function open(approval?: Record<string, unknown>, items: unknown[] = []) {
    const sent: { t: string; [k: string]: unknown }[] = []; let push: (m: unknown) => void = () => undefined;
    (window as { centcom?: unknown }).centcom = { desktop: true, local: { send: (m: { t: string }) => sent.push(m), onMessage: (cb: (m: unknown) => void) => { push = cb; return () => undefined; } } };
    render(<LocalPage />); const st = (installed: boolean) => ({ installed, version: '1.0', signedIn: 'yes' as const, kind: 'subscription' });
    await act(async () => push({ t: 'launcher', home: '/h', cwd: '/h/p', recent: [], claude: st(true), codex: st(true), prefs: { theme: 'auto', side: true, engine: 'claude-code' } }));
    await act(async () => push({ t: 'opened', dir: '/h/p', history: [] }));
    await act(async () => push({ t: 'state', state: { busy: !!approval, verb: 'Working', branch: 'main', engineLabel: 'Claude Code', approvals: approval ? [{ id: 'a1', tool: 'Edit', summary: 'src/a.ts', agentName: 'you', ...approval }] : [] }, changed: items, order: (items as { id: string }[]).map((i) => i.id) }));
    return sent;
  }
  it('a medium-risk approval offers once, this session, always in this project and deny; a high-risk one only once and deny', async () => {
    const sent = await open({ risk: 'medium', diff: '@@ -1,1 +1,1 @@\n-a\n+b' });
    expect(screen.getByText('Allow Cento to edit a file?')).toBeTruthy(); expect(screen.getByText('medium risk')).toBeTruthy(); fireEvent.click(screen.getByText('Always allow in this project')); expect(sent.at(-1)).toEqual({ t: 'approve', decision: 'approve', scope: 'always' });
    fireEvent.click(screen.getByText('Allow for this session')); expect(sent.at(-1)).toEqual({ t: 'approve', decision: 'approve', scope: 'session' }); cleanup();
    await open({ risk: 'high', tool: 'Bash', command: 'rm -rf build' }); expect(screen.getByText('Allow Cento to run a command?')).toBeTruthy(); expect(screen.getByText('rm -rf build')).toBeTruthy(); expect(screen.queryByText('Allow for this session')).toBeNull(); expect(screen.queryByText('Always allow in this project')).toBeNull(); expect(screen.getByText('Allow once')).toBeTruthy(); expect(screen.getByText('Deny')).toBeTruthy();
  });
  it('your message and the answer are laid out as a turn each; tool calls show their status by glyph and by hidden text', async () => {
    await open(undefined, [
      { kind: 'user', id: 'u', text: 'fix **it**', ts: 1 }, { kind: 'assistant', id: 'a', messageId: 'a', agentId: 'x', text: 'Done with `x`.', done: true },
      { kind: 'tool', id: 't1', toolId: 't1', agentId: 'x', name: 'Read', summary: 'a.ts', risk: 'low', status: 'ok', result: '12 lines' }, { kind: 'tool', id: 't2', toolId: 't2', agentId: 'x', name: 'Bash', summary: 'npm test', risk: 'low', status: 'error', result: 'exit 1' },
      { kind: 'tool', id: 't3', toolId: 't3', agentId: 'x', name: 'Edit', summary: 'b.ts', risk: 'medium', status: 'denied', result: 'declined' }, { kind: 'thinking', id: 'k', done: true, ms: 2400, text: '' },
    ]);
    const log = screen.getByRole('log', { name: 'Transcript' }); expect(log.querySelector('.lc-turn--user .lc-plain')?.textContent).toBe('fix **it**'); // what you typed is shown as typed
    expect(log.querySelector('.lc-turn--agent code.lc-code')?.textContent).toBe('x'); expect([...log.querySelectorAll('.lc-tool__glyph')].map((g) => g.textContent)).toEqual(['●', '✗', '⊘']);
    expect([...log.querySelectorAll('.lc-tool .cc-vh')].map((g) => g.textContent?.trim())).toEqual(['· ok', '· error', '· denied']); expect(log.textContent).toContain('∴ thought for 2s'); expect(log.textContent).toContain('exit 1');
  });
});
