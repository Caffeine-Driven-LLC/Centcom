import { useEffect, useState } from 'react';
import { Cento } from './Cento.js';
import { Icon } from './Icon.js';
import type { Conn } from './net.js';

const short = (p: string, home: string) => (p.startsWith(home) ? '~' + p.slice(home.length) : p);
type Engine = 'claude-code' | 'codex';

export function Launcher({ c, onStart }: { c: Conn; onStart: (dir: string, demo: boolean, mode: 'web' | 'app', engine: Engine, resume?: string) => void }) {
  const { launcher: L, dir } = c;
  const [demo, setDemo] = useState(false); const [engine, setEngine] = useState<Engine>('claude-code');
  const [cont, setCont] = useState(true);
  const [typed, setTyped] = useState(''); const [chosen, setChosen] = useState<string>();
  useEffect(() => { if (L && !dir) c.send({ t: 'browse', path: L.cwd }); }, [L, dir, c]);
  useEffect(() => { if (dir) setTyped(dir.path); }, [dir]);
  useEffect(() => { if (!L) return; if (!L.claude.installed && !L.codex.installed) setDemo(true); else if (!L.claude.installed && L.codex.installed) setEngine('codex'); else setEngine(L.prefs.engine); }, [L?.prefs.engine, L?.claude.installed, L?.codex.installed]);
  if (!L) return <div className="center"><div className="boot"><Cento state="thinking" color="violet" px={5} reduced={false} /><span>{c.up ? 'Loading…' : 'Connecting to Centcom…'}</span></div></div>;

  const go = (p: string) => { setChosen(undefined); c.send({ t: 'browse', path: p }); };
  const target = chosen ?? dir?.path; const st = engine === 'codex' ? L.codex : L.claude; const name = engine === 'codex' ? 'Codex' : 'Claude Code';
  const status = !st.installed ? { cls: 'warn', text: `${name} was not found. You can still try the demo agent.` }
    : st.signedIn === 'no' ? { cls: 'warn', text: `Not signed in. Run ${engine === 'codex' ? 'codex login' : 'claude auth login'} in a terminal.` }
      : { cls: 'ok', text: `${name} ${st.version ?? ''} · ${st.kind === 'subscription' ? 'your subscription' : st.kind === 'api_key' ? 'your API key' : 'ready'}` };
  const saved = dir && target === dir.path ? dir.saved ?? 0 : 0;
  const go2 = (mode: 'web' | 'app') => target && onStart(target, demo, mode, engine, saved > 0 && cont && !demo ? 'last' : undefined);

  return (
    <div className="launcher">
      <aside className="hero">
        <div className="brand"><Cento state="first-run" color="violet" px={7} reduced={false} /><h1>Centcom</h1><p>Command many hands.</p></div>
        <div className="field"><label>Agent</label>
          <div className="seg" role="radiogroup" aria-label="Agent">{(['claude-code', 'codex'] as const).map((e) => <button key={e} role="radio" aria-checked={engine === e} className={engine === e ? 'on' : ''} onClick={() => setEngine(e)}>{e === 'codex' ? 'Codex' : 'Claude Code'}</button>)}</div>
          <div className={`status ${status.cls}`}><i />{status.text}</div>
          <label className="check"><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /><span>Use the demo agent <small>No login, scripted</small></span></label>
        </div>
        {L.recent.length > 0 && <div className="field"><label>Recent</label><div className="recent">
          {L.recent.slice(0, 5).map((r) => <button key={r.dir} className="rrow" onClick={() => { setChosen(r.dir); c.send({ t: 'browse', path: r.dir }); }}><Icon name="folder" size={15} /><span><b>{r.dir.split('/').pop() || r.dir}</b><small>{short(r.dir, L.home)}</small></span></button>)}</div></div>}
        <p className="legal">Centcom drives your own CLI. It never sees your login. A product of Caffeine Driven.</p>
      </aside>

      <main className="picker">
        <div className="phead"><h2>Choose a project</h2><p>Pick the folder Cento should work in.</p></div>
        <form className="pathbar" onSubmit={(e) => { e.preventDefault(); go(typed); }}>
          <button type="button" className="iconbtn" title="Parent folder" aria-label="Parent folder" disabled={!dir?.parent} onClick={() => dir?.parent && go(dir.parent)}><Icon name="up" /></button>
          <button type="button" className="iconbtn" title="Home folder" aria-label="Home folder" onClick={() => go(L.home)}><Icon name="home" /></button>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} spellCheck={false} aria-label="Folder path" placeholder="/path/to/project" />
        </form>
        <div className="list" role="listbox" aria-label="Folders">
          {dir?.error && <div className="empty"><Icon name="lock" size={20} /><b>{dir.error}</b><small>Choose another folder or go up a level.</small></div>}
          {dir && !dir.error && dir.entries.length === 0 && <div className="empty"><Icon name="folder" size={20} /><b>No sub-folders here</b><small>You can start in this folder.</small></div>}
          {dir?.entries.map((e) => { const p = `${dir.path}/${e.name}`; const on = chosen === p; return (
            <button key={e.name} className="frow" role="option" aria-selected={on} data-sel={on} onClick={() => { setChosen(p); setTyped(p); }} onDoubleClick={() => go(p)}>
              <Icon name="folder" size={16} /><span>{e.name}</span>{e.git && <span className="tag"><Icon name="git" size={11} />git</span>}<Icon name="chevron" size={14} className="go" onClick={(ev) => { ev.stopPropagation(); go(p); }} />
            </button>); })}
        </div>
        <footer className="foot">
          <div className="target"><small>Working in</small><b title={target}>{target ? short(target, L.home) : 'Nothing selected'}</b></div>
          {saved > 0 && !demo && <label className="check inline"><input type="checkbox" checked={cont} onChange={(e) => setCont(e.target.checked)} /><span>Continue last conversation <small>{saved} saved</small></span></label>}
          <button className="btn" disabled={!target || !L.app} onClick={() => go2('app')} title={L.app ? 'Opens a window without browser chrome' : 'Needs Chrome, Chromium, Brave or Edge'}>Start as app</button>
          <button className="btn primary" disabled={!target} onClick={() => go2('web')}>Start on web</button>
        </footer>
        {c.notice && <div className={`toast ${c.notice.level}`} key={c.notice.n} role="status">{c.notice.text}</div>}
      </main>
    </div>
  );
}
