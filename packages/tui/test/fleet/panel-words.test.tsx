import React from 'react';
import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { createTheme } from '@centcom/theme';
import { AppController } from '../../src/controller.js';
import { ThemeCtx } from '../../src/components/ui.js';
import { FleetPanel } from '../../src/components/FleetPanel.js';
import { STATE_LABELS } from '../../src/fleet/labels.js';

/** Lane C042: the panel in the app speaks with the fleet module's table: the same words, glyphs and order as the rail and the web board. */
describe('the fleet panel in the app uses the shared state table', () => {
  const ctl = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [] });
  const agent = (id: string, state: string) => ({ ...ctl.state.agents[0]!, id, name: id, state, busy: state !== 'idle', branch: `b-${id}` });
  const show = (states: string[]) => { ctl.patch({ agents: states.map((s, i) => agent('a' + i, s)) }); return renderToString(<ThemeCtx.Provider value={createTheme('dark', 'none')}><FleetPanel s={ctl.state} width={30} height={40} /></ThemeCtx.Provider>, { columns: 40 }); };
  it('shows each state as its glyph and word from the table, with no colour needed', () => {
    const out = show(['idle', 'awaiting-approval', 'error']);
    for (const st of ['idle', 'awaiting-approval', 'error']) expect(out).toContain(`${STATE_LABELS[st]!.glyph} ${STATE_LABELS[st]!.word}`);
  });
  it('lists errors first, then what needs you, then work, then idle', () => {
    const out = show(['idle', 'running-command', 'awaiting-approval', 'error']); const at = (n: string) => out.indexOf(n);
    expect(at('a3')).toBeLessThan(at('a2')); expect(at('a2')).toBeLessThan(at('a1')); expect(at('a1')).toBeLessThan(at('a0'));
  });
  it('a state the client does not know shows as working instead of its raw id', () => { expect(show(['idle', 'brand-new-state'])).toContain('working'); });
});
