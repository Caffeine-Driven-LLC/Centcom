// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { ModelMenu } from '../../src/local/ModelMenu.js';
import { emptyView, installedEngines, isShown, reduceLocal } from '../../src/local/model.js';

afterEach(cleanup);
const st = { installed: true, version: '1', signedIn: 'yes' as const, kind: 'subscription' as never };
const launcher = (o: { claude?: boolean; codex?: boolean } = {}) => ({ t: 'launcher' as const, home: '/h', cwd: '/h/p', recent: [], claude: { ...st, installed: o.claude ?? true }, codex: { ...st, installed: o.codex ?? true }, prefs: { theme: 'auto' as const, side: true, engine: 'claude-code' as const } });
const m = (id: string, label: string) => ({ id, label, note: '' });
const viewOf = (o: { engine?: 'claude-code' | 'codex'; demo?: boolean; both?: boolean } = {}) => {
  let v = reduceLocal(emptyView(), launcher()); v = reduceLocal(v, { t: 'opened', dir: '/h/p', history: [], engine: o.engine ?? 'claude-code', demo: o.demo ?? false });
  v = reduceLocal(v, { t: 'models', models: o.engine === 'codex' ? [m('gpt-x', 'GPT X')] : [m('claude-opus-5-5', 'Opus 5.5')] });
  if (o.both !== false) v = reduceLocal(v, { t: 'engineModels', engines: [{ engine: 'claude-code', models: [m('claude-opus-5-5', 'Opus 5.5'), m('claude-sonnet-5-5', 'Sonnet 5.5')] }, { engine: 'codex', models: [m('gpt-x', 'GPT X')] }] });
  return v;
};

describe('the model menu with Claude Code and Codex', () => {
  it('lists both agents in groups and picks a model of the shown agent in place', () => {
    const sent: unknown[] = []; render(<ModelMenu view={viewOf()} send={(x) => sent.push(x)} />);
    const sel = screen.getByLabelText('Model') as HTMLSelectElement; expect(sel.value).toBe('claude-code|');
    expect([...sel.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Claude Code', 'Codex']);
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Default', 'Opus 5.5', 'Sonnet 5.5', 'Codex default', 'GPT X']);
    fireEvent.change(sel, { target: { value: 'claude-code|claude-sonnet-5-5' } }); expect(sent).toEqual([{ t: 'setModel', id: 'claude-sonnet-5-5' }]);
  });
  it('a model of the other agent opens that agent, then sets the model there', async () => {
    const sent: unknown[] = []; const send = (x: unknown) => sent.push(x); const r = render(<ModelMenu view={viewOf()} send={send as never} />);
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'codex|gpt-x' } }); expect(sent).toEqual([{ t: 'open', dir: '/h/p', engine: 'codex' }]);
    await act(async () => { r.rerender(<ModelMenu view={viewOf({ engine: 'codex' })} send={send as never} />); });
    expect(sent.at(-1)).toEqual({ t: 'setModel', id: 'gpt-x' }); expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('codex|');
  });
  it('is the plain model menu with one agent, and absent in the demo', () => {
    const a = render(<ModelMenu view={viewOf({ both: false })} send={() => undefined} />); expect(screen.getByLabelText('Model').querySelectorAll('optgroup').length).toBe(0); a.unmount();
    const b = render(<ModelMenu view={viewOf({ demo: true })} send={() => undefined} />); expect(b.container.querySelectorAll('optgroup').length).toBe(0);
  });
  it('knows which of two sessions in one folder is shown', () => {
    const v = viewOf({ engine: 'codex' }); const claude = { dir: '/h/p', engine: 'claude-code' as const, demo: false, busy: false, waiting: 0 };
    expect(isShown(claude, v)).toBe(false); expect(isShown({ ...claude, engine: 'codex' }, v)).toBe(true); expect(installedEngines(v.launcher)).toEqual(['claude-code', 'codex']);
  });
});
