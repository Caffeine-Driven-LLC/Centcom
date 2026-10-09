import React from 'react';
import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { createTheme } from '@centcom/theme';
import { AppController } from '../src/controller.js';
import { ThemeCtx } from '../src/components/ui.js';
import { Header } from '../src/components/Header.js';
import { StatusLine } from '../src/components/StatusLine.js';
import { Approval } from '../src/components/Approval.js';
import { Prompt, SlashPopup, slashMatches } from '../src/components/Prompt.js';
import { Toasts } from '../src/components/Toasts.js';
import { MultiSelect } from '../src/pick/MultiSelect.js';
import { MentionPopup } from '../src/components/MentionPopup.js';
import { newPick } from '../src/pick/model.js';
import { textWidth } from '../src/util/text.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const LONG = 'feature/a-very-long-branch-name-that-goes-on-and-on-and-on-for-way-too-long';
const ctl = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/home/devlsx/Desktop/actualprojects/some-really-long-project-folder-name/packages/deeply/nested', branch: LONG, version: 't', skills: [] });
ctl.patch({ busy: true, turnStartedAt: Date.now() - 125_000, limits: [{ name: '5h', utilization: 0.93, resets_at: Date.now() + 3_600_000 }], toasts: [{ id: 't', level: 'warn', text: 'A fairly long toast message that has to fit on a very narrow screen without breaking it', until: Date.now() + 9999 }] as never });
const approval = (risk: 'medium' | 'high') => ({ req: { approval_id: 'a', agent_id: 'me', tool_id: 't', tool: 'Bash', summary: 'x', risk, command: 'find . -name "*.log" -not -path "./node_modules/*" -exec grep -l "ERROR" {} + | xargs wc -l | sort -rn | head -20', path: undefined }, agentName: 'you', color: 'violet', resolve() {}, confirmHigh: false, expiresAt: Date.now() + 590_000 } as never);
const pick = newPick({ title: 'A rather long title that needs to wrap or be cut somewhere', note: 'And a long note below it as well, to be safe', options: [{ id: 'a', label: 'An option with a long label that goes on', hint: 'and a hint that also goes on for a while' }, { id: 'b', label: 'short' }] });
const SCREENS: [string, (w: number) => React.ReactElement][] = [
  ['header', (w) => <Header s={ctl.state} width={w} />], ['status line', (w) => <StatusLine s={ctl.state} width={w} />],
  ['approval', (w) => <Approval a={approval('medium')} width={w} confirming={false} />], ['approval (destructive)', (w) => <Approval a={approval('high')} width={w} confirming />],
  ['prompt', (w) => <Prompt text={'a long line of text '.repeat(12)} cursor={20} busy={false} width={w} active placeholder="Message Cento…" />], ['command menu', (w) => <SlashPopup matches={slashMatches('/')} sel={0} width={w} />],
  ['file suggestions', (w) => <MentionPopup items={['packages/tui/src/components/a-rather-long-file-name-for-testing.tsx', 'README.md', 'apps/cli/src/main.tsx']} sel={1} width={w} />],
  ['toasts', (w) => <Toasts toasts={ctl.state.toasts} width={w - 1} />], ['list picker', (w) => <MultiSelect p={pick} width={w} height={20} />],
];
describe('nothing is wider than the screen', () => {
  for (const [name, make] of SCREENS) for (const w of [40, 50, 60, 80, 100, 140]) {
    it(`${name} at ${w} columns`, () => {
      const out = strip(renderToString(<ThemeCtx.Provider value={createTheme('dark', 'truecolor')}>{make(w)}</ThemeCtx.Provider>, { columns: w }));
      const over = out.split('\n').filter((l) => textWidth(l) > w); expect(over).toEqual([]);
    });
  }
});

describe('a list never needs more rows than it was given', () => {
  const many = newPick({ title: 'Settings', note: 'Choose one to change it. Esc closes.', options: Array.from({ length: 14 }, (_, i) => ({ id: String(i), label: `Setting number ${i}: value`, hint: 'a hint' })), multi: true });
  const short = newPick({ title: 'Short', options: [{ id: 'a', label: 'one' }, { id: 'b', label: 'two' }] });
  it.each([6, 8, 10, 12, 13, 14, 15, 16, 18, 20, 24, 30, 40])('at %i rows the box fits (anywhere in a long list, with and without a note)', async (h) => {
    const { pickLayout } = await import('../src/pick/MultiSelect.js');
    for (const [name, p] of [['top', many], ['middle', { ...many, sel: 7 }], ['end', { ...many, sel: 13 }], ['no note', { ...many, note: undefined }], ['short list', short]] as const) {
      const L = pickLayout(p, h); expect(L.rows, `${name} at height ${h}: ${L.rows} rows`).toBeLessThanOrEqual(Math.max(h, 9 + (L.compact ? 0 : 2))); // the least a box with a title, two rows, its buttons and hint can be
      expect(L.shown.length).toBeGreaterThanOrEqual(Math.min(2, p.options.length)); expect(L.shown.some((o) => o === p.options[p.sel])).toBe(true); // the highlighted row is always on screen
    }
  });
  it('the same box, drawn: its highlighted row is visible at 24 rows deep into the list', () => {
    const out = strip(renderToString(<ThemeCtx.Provider value={createTheme('dark', 'truecolor')}><MultiSelect p={{ ...many, sel: 11 }} width={80} height={13} /></ThemeCtx.Provider>, { columns: 80 })); expect(out).toContain('Setting number 11'); expect(out).toContain('more');
  });
});

describe('the answers of a permission prompt stay readable on every width', () => {
  for (const risk of ['medium', 'high'] as const) for (const w of [60, 64, 70, 78, 80, 100, 140]) {
    it(`${risk} risk at ${w} columns shows whole [y] yes and [n] no${risk === 'medium' ? ' (and the session and always answers)' : ''}`, () => {
      const out = strip(renderToString(<ThemeCtx.Provider value={createTheme('dark', 'truecolor')}><Approval a={approval(risk)} width={w} confirming={false} /></ThemeCtx.Provider>, { columns: w }));
      expect(out).toContain('[y] yes'); expect(out).toContain('[n] no'); if (risk === 'medium') { expect(out).toContain('[s] session'); expect(out).toContain('[a] always'); expect(out).not.toMatch(/\[[ysan]\] \S*…/); }
    });
  }
});

describe('the mascot strip offers the same answers as the permission dialog', () => {
  it('the strip only says that something waits (the dialog below carries the keys); a second request is counted', async () => {
    const { LiveStrip } = await import('../src/components/LiveStrip.js'); const { MascotDriver } = await import('@centcom/mascot');
    const c = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [] }); c.patch({ items: [{ id: 'u', kind: 'user', text: 'x' } as never] });
    const strip = (risk: 'medium' | 'high') => { c.patch({ approvals: [approval(risk)] }); return strip_(renderToString(<ThemeCtx.Provider value={createTheme('dark', 'truecolor')}><LiveStrip s={c.state} driver={new MascotDriver({}) as never} width={70} size="small" /></ThemeCtx.Provider>, { columns: 80 })); };
    const strip_ = (x: string) => x.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    for (const r of ['high', 'medium'] as const) { const x = strip(r); expect(x).toContain('Waiting for you'); expect(x).not.toContain('y yes'); } c.patch({ approvals: [approval('medium'), approval('medium')] }); expect(strip_(renderToString(<ThemeCtx.Provider value={createTheme('dark', 'truecolor')}><LiveStrip s={c.state} driver={new MascotDriver({}) as never} width={70} size="small" /></ThemeCtx.Provider>, { columns: 80 }))).toContain('+1 more'); c.stop();
  });
});

describe('the welcome screen respects "mascot off" and the idle slowdown', () => {
  it('no picture (and so nothing to animate) when the mascot is off; the text stays', async () => {
    const { Welcome } = await import('../src/components/Welcome.js'); const c = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [] });
    const draw = (mascot: boolean) => renderToString(<ThemeCtx.Provider value={createTheme('dark', 'truecolor')}><Welcome s={c.state} width={100} height={24} color="violet" reduced={false} mascot={mascot} /></ThemeCtx.Provider>, { columns: 100 }).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    const on = draw(true); const off = draw(false); expect(off).toContain('Command many hands.'); expect(off).toContain('Type a task and press Enter'); expect(on.split('\n').filter((l) => /[▀▄█]/.test(l)).length).toBeGreaterThan(off.split('\n').filter((l) => /[▀▄█]/.test(l) && !/█▀|▀█|▄▀▀|▀▀/.test('')).length - 10); c.stop();
  });
});

describe('the permission dialog carries the answers (the strip above it no longer repeats them)', () => {
  it('a destructive request offers only yes and no; others also offer this session and always', () => {
    const show = (risk: 'medium' | 'high') => renderToString(<ThemeCtx.Provider value={createTheme('dark', 'truecolor')}><Approval a={approval(risk)} width={80} confirming={false} /></ThemeCtx.Provider>, { columns: 80 }).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    const high = show('high'); expect(high).toContain('[y] yes'); expect(high).toContain('[n] no'); expect(high).not.toContain('always'); expect(high).not.toContain('[s]');
    const mid = show('medium'); expect(mid).toContain('[s] session'); expect(mid).toContain('[a] always');
  });
});

describe('welcome and tool status, by shape as well as colour', () => {
  it('the welcome screen offers to continue the newest conversation of this folder (not in the demo), with a short title and when it was', async () => {
    const { Welcome } = await import('../src/components/Welcome.js'); const { FakeEngine } = await import('@centcom/testkit');
    const { SessionStore } = await import('../src/sessions.js'); const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
    const sessions = new SessionStore(mkdtempSync(join(tmpdir(), 'cc-welcome-'))); sessions.save({ id: 'ses_01JTEST000000000000000000W', cwd: '/tmp', title: 'Fix the flaky importer test and tidy the fixtures folder afterwards', engine: 'claude-code', createdAt: Date.now() - 3 * 3600_000, updatedAt: Date.now() - 2 * 3600_000, messages: 2 } as never, [{ kind: 'user', id: 'u1', text: 'Fix the flaky importer test and tidy the fixtures folder afterwards', ts: 1 }]);
    const c = new AppController({ engine: new FakeEngine({ id: 'claude-code' }) as never, demo: false, cwd: '/tmp', version: 't', skills: [], sessions: sessions as never }); await c.start();
    const draw = (width: number) => renderToString(<ThemeCtx.Provider value={createTheme('dark', 'truecolor')}><Welcome s={c.state} width={width} height={24} color="violet" reduced={false} mascot={false} /></ThemeCtx.Provider>, { columns: width }).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    for (const w of [100, 60]) { const out = draw(w); expect(out).toContain('/resume'); expect(out).toContain('Fix the flaky importer'); expect(out).toMatch(/just now|ago/); expect(out.split('\n').every((l) => [...l].length <= w)).toBe(true); }
    const demo = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [], sessions: sessions as never }); await demo.start(); expect(renderToString(<ThemeCtx.Provider value={createTheme('dark', 'truecolor')}><Welcome s={demo.state} width={100} height={24} color="violet" reduced={false} mascot={false} /></ThemeCtx.Provider>, { columns: 100 })).not.toContain('/resume'); c.stop(); demo.stop(); sessions.close();
  });
  it('a failed tool call starts with ✗ and a declined one with ⊘; the rest keep ●', async () => {
    const { itemLines } = await import('../src/util/transcript.js'); const first = (status: string) => (itemLines({ kind: 'tool', id: 't', toolId: 't', agentId: 'a', name: 'Bash', summary: 'ls', risk: 'low', status } as never, 60)[0] ?? []).map((s) => s.t).join('');
    expect(first('error')).toMatch(/^✗ Bash/); expect(first('denied')).toMatch(/^⊘ Bash/); expect(first('ok')).toMatch(/^● Bash/); expect(first('running')).toMatch(/^● Bash/);
  });
});
