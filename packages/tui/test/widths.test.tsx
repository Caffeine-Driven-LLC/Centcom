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
