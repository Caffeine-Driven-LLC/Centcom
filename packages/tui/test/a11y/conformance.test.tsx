import React from 'react';
import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { createTheme } from '@centcom/theme';
import { AppController } from '../../src/controller.js';
import { assertNoColorCodes, assertNoEscape } from '../../src/a11y/index.js';
import { ThemeCtx } from '../../src/components/ui.js';
import { StatusBar } from '../../src/components/StatusBars.js';
import { PermissionPrompt, approvalFromPending } from '../../src/permission/index.js';
import { Toasts } from '../../src/components/Toasts.js';
import { ToastView } from '../../src/toast/index.js';
import { Prompt, SlashPopup, slashMatches } from '../../src/components/Prompt.js';
import { Palette } from '../../src/components/Overlays.js';
import { FleetPanel, fleetFromAgents, STATE_MAP } from '../../src/index.js';
import { Transcript } from '../../src/components/Transcript.js';
import { TranscriptLayout } from '../../src/transcript/layout.js';
import { NightPanel } from '../../src/night/NightPanel.js';
import { MultiSelect } from '../../src/pick/MultiSelect.js';
import { MentionPopup } from '../../src/components/MentionPopup.js';
import { newPick, pickToggle } from '../../src/pick/model.js';
import { HelpBody, actions, defaultKeymap } from '../../src/keys/index.js';

const ctl = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [] });
const items = [{ id: 'u1', kind: 'user', text: 'fix the bug' }, { id: 'a1', kind: 'assistant', text: 'Found **it** in `isExpired`.', done: true }, { id: 'n1', kind: 'notice', level: 'error', text: 'Something went wrong', detail: 'details' }] as never[];
const layout = new TranscriptLayout().update(items, 70);
ctl.patch({ items });
const approval = approvalFromPending({ req: { approval_id: 'a', agent_id: 'me', tool_id: 't', tool: 'Bash', summary: 'x', risk: 'high', command: 'rm -rf build' }, agentName: 'you' } as never, { engine: 'claude-code' });
const pick = pickToggle(newPick({ title: 'Pick', options: [{ id: 'a', label: 'one', hint: 'first' }, { id: 'b', label: 'two' }] }));

/** Every screen the app can show, drawn with no colour (NO_COLOR): nothing may carry a colour or escape code, and meaning must survive without it. */
const SCREENS: [string, () => React.ReactElement][] = [
  ['header', () => <StatusBar s={ctl.state} width={80} line="header" />],
  ['footer', () => <StatusBar s={ctl.state} width={80} line="footer" />],
  ['permission prompt', () => <PermissionPrompt request={approval} canDecide onDecide={() => undefined} cols={82} />],
  ['prompt', () => <Prompt text="hello world" cursor={5} anchor={0} busy={false} width={80} active placeholder="Message Cento…" />],
  ['command menu', () => <SlashPopup matches={slashMatches('/')} sel={0} width={80} />],
  ['palette', () => <Palette query="" sel={0} width={80} />],
  ['toasts', () => <Toasts toasts={[{ id: 'toast_1', level: 'warn', text: 'a warn toast', count: 1, expiresAt: null }]} width={80} />],
  ['fleet rail with mini mascots', () => <FleetPanel agents={fleetFromAgents(ctl.state.agents, { since: () => new Date(0).toISOString() })} selfMemberId="self" selfSlot={0} mode="rail" onSelect={() => undefined} interactive={false} mascots={{ tier: 'none', unicode: true, motion: 'full', stateMap: STATE_MAP }} />],
  ['transcript', () => <Transcript layout={layout} items={items} width={70} height={12} scroll={0} />],
  ['night panel', () => <NightPanel n={ctl.state.night} width={80} height={20} />],
  ['file suggestions', () => <MentionPopup items={['src/a.ts', 'docs/b.md']} sel={0} width={80} />],
  ['list picker', () => <MultiSelect p={pick} width={80} height={16} />],
  ['help', () => <HelpBody actions={actions()} keymap={defaultKeymap(actions())} warnings={[]} width={100} height={30} filter="" />],
  ['help, editing page', () => <HelpBody actions={actions()} keymap={defaultKeymap(actions())} warnings={[]} width={100} height={30} filter="" page={1} />],
];
describe('NO_COLOR conformance across the whole interface', () => {
  const theme = createTheme('dark', 'none');
  it.each(SCREENS)('%s has no colour or escape codes and is not empty', (_name, make) => {
    const out = renderToString(<ThemeCtx.Provider value={theme}>{make()}</ThemeCtx.Provider>, { columns: 100 });
    expect(out.trim().length).toBeGreaterThan(0); assertNoColorCodes(out); assertNoEscape(out);
  });
  it('a status is never colour alone: every level of toast and notice shows its own word or symbol', () => {
    const t = ['info', 'success', 'warn', 'error'].map((level) => renderToString(<ThemeCtx.Provider value={theme}><ToastView toast={{ id: level, level, text: `a ${level === 'success' ? 'ok' : level} toast`, count: 1, expiresAt: null } as never} width={80} unicode={false} /></ThemeCtx.Provider>, { columns: 100 })).join('\n');
    for (const w of ['info toast', 'ok toast', 'warn toast', 'error toast']) expect(t).toContain(w);
    const symbols = new Set(t.split('\n').filter((l) => /toast/.test(l)).map((l) => l.trim().split(/\s+/)[0])); expect(symbols.size).toBeGreaterThanOrEqual(3); // levels differ by a glyph, not only by colour
    const a = renderToString(<ThemeCtx.Provider value={theme}><PermissionPrompt request={approval} canDecide onDecide={() => undefined} cols={82} /></ThemeCtx.Provider>, { columns: 100 }); expect(a).toMatch(/high risk/); expect(a).toContain('[y]'); expect(a).toContain('[n]');
    const st = renderToString(<ThemeCtx.Provider value={theme}><StatusBar s={ctl.state} width={90} line="footer" /></ThemeCtx.Provider>, { columns: 100 }); expect(st).toMatch(/idle|working|needs you/);
  });
});
