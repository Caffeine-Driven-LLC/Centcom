import React, { useEffect, useRef } from 'react';
import type { ClientMsg } from '../../../desktop/src/local/protocol.js';
import { ENGINE_NAMES, type LocalView } from './model.js';

type Engine = 'claude-code' | 'codex';
const enc = (e: Engine, id: string): string => `${e}|${id}`;

/**
 * The one model menu: with both Claude Code and Codex installed it lists both agents' models in
 * groups. A model of the other agent switches this folder to that agent (starting it, or coming
 * back to it) and then picks the model there.
 */
export function ModelMenu({ view, send }: { view: LocalView; send(m: ClientMsg): void }): React.JSX.Element | null {
  const cur = view.openedEngine; const dir = view.opened; const pending = useRef<{ engine: Engine; id: string } | null>(null);
  useEffect(() => { const p = pending.current; if (p && cur && cur.engine === p.engine) { pending.current = null; send({ t: 'setModel', id: p.id }); } }, [cur, send]);
  if (!dir || !cur) return null;
  const groups = view.engineModels.filter((g) => g.models.length);
  const multi = groups.length > 1 && !cur.demo;
  const value = enc(cur.engine, view.state?.settings?.model ?? '');
  if (!multi) return view.models.length ? <label className="lc-sel"><span>Model</span><select aria-label="Model" value={view.state?.settings?.model ?? ''} onChange={(e) => send({ t: 'setModel', id: e.target.value })}><option value="">Default</option>{view.models.filter((x) => x.id).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label> : null;
  return <label className="lc-sel"><span>Model</span>
    <select aria-label="Model" value={value} onChange={(e) => {
      const [eng, ...rest] = e.target.value.split('|'); const id = rest.join('|'); const engine = eng as Engine;
      if (engine === cur.engine) { send({ t: 'setModel', id }); return; }
      pending.current = { engine, id }; send({ t: 'open', dir, engine });
    }}>
      {groups.map((g) => <optgroup key={g.engine} label={ENGINE_NAMES[g.engine]}>
        <option value={enc(g.engine, '')}>{g.engine === cur.engine ? 'Default' : `${ENGINE_NAMES[g.engine]} default`}</option>
        {g.models.filter((x) => x.id).map((x) => <option key={x.id} value={enc(g.engine, x.id)}>{x.label}</option>)}
      </optgroup>)}
    </select></label>;
}
