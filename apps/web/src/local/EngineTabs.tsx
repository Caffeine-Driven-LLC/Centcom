import React from 'react';
import type { ClientMsg } from '../../../desktop/src/local/protocol.js';
import { engineStatus, installedEngines, runningWord, type LocalView } from './model.js';

export const ENGINE_NAMES = { 'claude-code': 'Claude Code', codex: 'Codex' } as const;

/**
 * Tabs for the agents this project can run with, shown when both Claude Code and Codex are
 * installed. Each tab is its own running session: a click starts it (or comes back to it) and the
 * other keeps going in the background.
 */
export function EngineTabs({ view, send }: { view: LocalView; send(m: ClientMsg): void }): React.JSX.Element | null {
  const L = view.launcher; const dir = view.opened; const cur = view.openedEngine;
  if (!L || !dir || !cur || cur.demo) return null;
  const engines = installedEngines(L);
  if (engines.length < 2) return null;
  return <div className="lc-etabs" role="tablist" aria-label="Agent">
    {engines.map((e) => {
      const on = cur.engine === e; const st = engineStatus(L, e); const run = view.running.find((r) => r.dir === dir && r.engine === e && !r.demo);
      const state = run ? runningWord(run) : st.ok ? 'not started' : st.text;
      return <button key={e} type="button" role="tab" aria-selected={on} className="lc-etab" data-on={on} disabled={!on && !st.ok} title={`${ENGINE_NAMES[e]}: ${state}`} onClick={() => { if (!on) send({ t: 'open', dir, engine: e }); }}>
        <span className={`lc-etab__dot lc-etab__dot--${run ? (run.waiting ? 'wait' : run.busy ? 'busy' : 'ready') : 'off'}`} aria-hidden="true" />{ENGINE_NAMES[e]}
      </button>;
    })}
  </div>;
}
