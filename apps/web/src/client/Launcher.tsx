import { useEffect, useState } from 'react';
import { Cento } from './Cento.js';
import type { Conn } from './net.js';

const short = (p: string, home: string) => (p.startsWith(home) ? '~' + p.slice(home.length) : p);

export function Launcher({ c, onStart }: { c: Conn; onStart: (dir: string, demo: boolean, mode: 'web' | 'app') => void }) {
  const { launcher: L, dir } = c;
  const [demo, setDemo] = useState(false);
  const [typed, setTyped] = useState('');
  const [chosen, setChosen] = useState<string>();
  useEffect(() => { if (L && !dir) c.send({ t: 'browse', path: L.cwd }); }, [L, dir, c]);
  useEffect(() => { if (dir && !chosen) { setChosen(dir.git ? dir.path : undefined); setTyped(dir.path); } }, [dir, chosen]);
  useEffect(() => { if (L && L.claude.installed === false) setDemo(true); }, [L]);
  if (!L) return <div className="center muted">{c.up ? 'Loading…' : 'Connecting to Centcom…'}</div>;

  const go = (p: string) => { setChosen(undefined); c.send({ t: 'browse', path: p }); };
  const target = chosen ?? dir?.path;
  const claude = L.claude;
  const status = !claude.installed ? { cls: 'warn', text: 'Claude Code was not found. You can still try the demo agent.' }
    : claude.signedIn === 'no' ? { cls: 'warn', text: 'Claude Code is installed but not signed in. Run `claude auth login`.' }
      : { cls: 'ok', text: `Claude Code ${claude.version ?? ''} ready${claude.kind ? ` · ${claude.kind === 'subscription' ? 'your subscription' : claude.kind === 'api_key' ? 'your API key' : claude.kind}` : ''}` };

  return (
    <div className="launcher">
      <aside className="hero">
        <Cento state="first-run" color="violet" px={9} reduced={false} />
        <h1>Centcom</h1>
        <p className="tag">Command many hands.</p>
        <div className={`pill ${status.cls}`}>{status.text}</div>
        {L.recent.length > 0 && (
          <div className="recent"><h3>Recent</h3>
            {L.recent.slice(0, 6).map((r) => <button key={r.dir} className="row" onClick={() => { setChosen(r.dir); setTyped(r.dir); c.send({ t: 'browse', path: r.dir }); }}><span>{r.dir.split('/').pop() || r.dir}</span><small>{short(r.dir, L.home)}</small></button>)}
          </div>)}
      </aside>

      <main className="picker">
        <h2>Pick a project folder</h2>
        <form className="pathbar" onSubmit={(e) => { e.preventDefault(); go(typed); }}>
          <button type="button" className="icon" title="Up one level" disabled={!dir?.parent} onClick={() => dir?.parent && go(dir.parent)}>↑</button>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} spellCheck={false} aria-label="Folder path" />
          <button type="button" className="icon" title="Home" onClick={() => go(L.home)}>⌂</button>
        </form>
        <div className="list" role="listbox" aria-label="Folders">
          {dir?.error && <div className="muted pad">{dir.error}</div>}
          {dir && !dir.error && dir.entries.length === 0 && <div className="muted pad">No sub-folders here.</div>}
          {dir?.entries.map((e) => (
            <button key={e.name} className="row" role="option" onDoubleClick={() => go(`${dir.path}/${e.name}`)} onClick={() => { setChosen(`${dir.path}/${e.name}`); setTyped(`${dir.path}/${e.name}`); }}
              aria-selected={chosen === `${dir.path}/${e.name}`} data-sel={chosen === `${dir.path}/${e.name}`}>
              <span>📁 {e.name}</span>{e.git && <small className="git">git</small>}
            </button>))}
        </div>
        <div className="foot">
          <div className="target"><small>Working in</small><strong>{target ? short(target, L.home) : '—'}</strong></div>
          <label className="check"><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> Demo agent <small>(no login, scripted)</small></label>
          <div className="actions">
            <button className="primary" disabled={!target} onClick={() => target && onStart(target, demo, 'web')}>Start on web</button>
            <button className="secondary" disabled={!target || !L.app} title={L.app ? 'Opens a window without browser chrome' : 'Needs Chrome, Chromium, Brave or Edge'} onClick={() => target && onStart(target, demo, 'app')}>Start as app</button>
          </div>
        </div>
        {c.notice && <div className={`toast ${c.notice.level}`} key={c.notice.n}>{c.notice.text}</div>}
      </main>
    </div>
  );
}
