import React from 'react';
import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { createTheme } from '@centcom/theme';
import { AppController } from '../../src/controller.js';
import { ThemeCtx } from '../../src/components/ui.js';
import { FleetPanel, fleetFromAgents, createSinceTracker } from '../../src/fleet/index.js';
import { STATE_MAP } from '../../src/mascot/index.js';
import { STATE_LABELS } from '../../src/fleet/labels.js';
import { textWidth } from '../../src/util/text.js';

const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
/** Lane C042: the rail in the app speaks with the fleet module's table (the same words, glyphs and order as the web board) and draws a mini Cento beside every row. */
describe('the fleet rail in the app uses the shared state table', () => {
  const ctl = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [] });
  const agent = (id: string, state: string) => ({ ...ctl.state.agents[0]!, id, name: id, state, busy: state !== 'idle', branch: `b-${id}` });
  const show = (states: string[], tier: 'none' | 'truecolor' = 'none') => {
    const agents = fleetFromAgents(states.map((s, i) => agent('a' + i, s)), { since: createSinceTracker(() => 0) });
    return renderToString(<ThemeCtx.Provider value={createTheme('dark', tier)}><FleetPanel agents={agents} selfMemberId="self" selfSlot={0} mode="rail" onSelect={() => undefined} interactive={false} now={() => new Date(5000)} mascots={{ tier, unicode: true, motion: 'full', stateMap: STATE_MAP }} /></ThemeCtx.Provider>, { columns: 40 });
  };
  it('shows each state as its glyph and word from the table, with no colour needed', () => {
    const out = show(['idle', 'awaiting-approval', 'error']);
    for (const st of ['idle', 'error']) expect(out).toContain(`${STATE_LABELS[st]!.glyph} ${STATE_LABELS[st]!.word}`);
    expect(out).toContain('? needs you'); // your own approval says so in words (someone else's says waiting)
  });
  it('lists errors first, then what needs you, then work, then idle', () => {
    const out = show(['idle', 'running-command', 'awaiting-approval', 'error']); const at = (n: string) => out.indexOf(n);
    expect(at('a3')).toBeLessThan(at('a2')); expect(at('a2')).toBeLessThan(at('a1')); expect(at('a1')).toBeLessThan(at('a0'));
  });
  it('a state the client does not know shows as working instead of its raw id', () => { expect(show(['idle', 'brand-new-state'])).toContain('working'); });
  it('every row is two lines tall with a mini Cento (6 columns) beside it, never wider than the 28-column rail', () => {
    const out = strip(show(['thinking', 'error', 'idle'], 'truecolor')).split('\n'); expect(out.length).toBeGreaterThanOrEqual(6); expect(Math.max(...out.map(textWidth))).toBeLessThanOrEqual(28);
    const plain = show(['thinking', 'error']).split('\n'); expect(plain.some((l) => l.includes('(x_x)'))).toBe(true); expect(plain.some((l) => l.includes('(•_•?)'))).toBe(true); // no colour: the text faces for error and thinking
  });
  it('rows name the owner by words (you / a teammate), not by colour', () => {
    const me = { ...agent('mine', 'idle'), mine: true }; const other = { ...agent('theirs', 'idle'), mine: false };
    const out = renderToString(<ThemeCtx.Provider value={createTheme('dark', 'none')}><FleetPanel agents={fleetFromAgents([me, other], { since: () => new Date(0).toISOString() })} selfMemberId="self" selfSlot={0} mode="rail" onSelect={() => undefined} interactive={false} now={() => new Date(1000)} mascots={{ tier: 'none', unicode: true, motion: 'full', stateMap: STATE_MAP }} /></ThemeCtx.Provider>, { columns: 40 });
    expect(out).toContain('mine'); expect(out).toContain('theirs · theirs');
  });
});
