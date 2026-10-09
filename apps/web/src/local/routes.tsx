import { createRoute } from '@tanstack/react-router';
import React, { useEffect, useRef, useState } from 'react';
import { rootRoute } from '../app/root.js';
import type { RouteModule } from '../app/types.js';
import { Banner, Button, Card, CentoMark, Chip, EmptyState, Input, Skeleton } from '../ui/index.js';
import type { Item } from '@centcom/tui';
import { Diff } from './Diff.js';
import { Markdown } from './Markdown.js';
import { engineStatus, pickEngine, shortPath, type LocalView } from './model.js';
import { useLocal } from './use-local.js';
import type { ClientMsg } from '../../../desktop/src/local/protocol.js';
import './local.css';

type Send = (m: ClientMsg) => void;
const baseName = (p: string): string => p.replace(/\/+$/, '').split('/').pop() || p;
/** "just now", "5 min ago", "3 h ago", "2 days ago" for the recent list. */
export function whenAgo(at: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - at) / 60000)); if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 24) return `${h} h ago`; const d = Math.round(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`;
}
const ENGINES: { id: 'claude-code' | 'codex'; name: string; blurb: string }[] = [{ id: 'claude-code', name: 'Claude Code', blurb: 'Anthropic' }, { id: 'codex', name: 'Codex', blurb: 'OpenAI' }];

function Picker({ view, send }: { view: LocalView; send: Send }): React.JSX.Element {
  const L = view.launcher!; const d = view.dir; const initial = pickEngine(L);
  const [engine, setEngine] = useState(initial.engine); const [demo, setDemo] = useState(initial.demo); const [typed, setTyped] = useState('');
  useEffect(() => { if (!d) send({ t: 'browse', path: L.cwd }); }, [d, L.cwd, send]);
  useEffect(() => { if (d) setTyped(d.path); }, [d]);
  const st = engineStatus(L, engine);
  return <div className="lc-home">
    <section className="lc-hero" aria-label="Welcome">
      <CentoMark size={72} />
      <div><h1 className="lc-hero__title">Command many hands.</h1><p className="lc-hero__sub">Open a project and pick an agent. It runs on this computer, with your own login.</p></div>
    </section>
    <div className="lc-cols">
      <section className="lc-panel" aria-label="Open a project">
        <h2 className="lc-h">Open a project</h2>
        <div className="lc-engines" role="group" aria-label="Agent">
          {ENGINES.map((e) => { const s = engineStatus(L, e.id); const info = e.id === 'codex' ? L.codex : L.claude; const on = engine === e.id;
            return <button key={e.id} type="button" className="lc-engine" aria-pressed={on} onClick={() => setEngine(e.id)}>
              <span className="lc-engine__top"><span className="lc-engine__name">{on ? '✓ ' : ''}{e.name}</span><span className={`lc-dot lc-dot--${s.ok ? 'ok' : 'off'}`} aria-hidden="true" /></span>
              <span className="lc-engine__meta">{e.blurb}{info.installed && info.version ? ` · ${info.version}` : ''}</span>
              <span className="lc-engine__state">{!info.installed ? 'not installed' : info.signedIn === 'yes' ? (info.kind === 'subscription' ? 'signed in · your subscription' : 'signed in') : info.signedIn === 'no' ? 'not signed in' : 'installed'}</span>
            </button>; })}
        </div>
        <label className="lc-toggle"><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> <span>Demo agent</span><span className="lc-toggle__hint">scripted, nothing real runs</span></label>
        {demo ? <Banner tone="info">Demo agent: nothing real runs.</Banner> : !st.ok ? <Banner tone="warning">{st.text}</Banner> : null}
        <form className="lc-path" onSubmit={(e) => { e.preventDefault(); send({ t: 'browse', path: typed }); }}><div className="lc-grow"><Input label="Folder" value={typed} onChange={(e) => setTyped(e.target.value)} /></div><Button type="submit">Go</Button></form>
        {d?.error ? <Banner tone="danger">{d.error}</Banner> : null}
        <div className="lc-dirs" role="list" aria-label="Folders">
          {d?.parent ? <button className="lc-dir lc-dir--up" role="listitem" onClick={() => send({ t: 'browse', path: d.parent! })}><span aria-hidden="true">↑</span> ..</button> : null}
          {d?.entries.map((e) => <button key={e.name} className="lc-dir" role="listitem" onClick={() => send({ t: 'browse', path: `${d.path}/${e.name}` })}><span className="lc-dir__glyph" aria-hidden="true">▸</span><span className="lc-dir__name">{e.name}</span>{e.git ? <span className="lc-tag">git</span> : null}</button>)}
        </div>
        <div className="lc-open">
          <Button variant="primary" disabled={!d || !!d.error} onClick={() => d && send({ t: 'open', dir: d.path, demo, engine })}>Open {d ? shortPath(d.path, L.home) : ''}</Button>
          {d?.saved ? <Chip>{d.saved} saved sessions</Chip> : null}
        </div>
      </section>
      <aside className="lc-side" aria-label="Recent projects">
        <h2 className="lc-h">Recent</h2>
        {L.recent.length ? <ul className="lc-recent">{L.recent.map((r) => <li key={r.dir}><button type="button" className="lc-recent__item" onClick={() => send({ t: 'open', dir: r.dir, demo, engine })}>
          <span className="lc-recent__name">{baseName(r.dir)}</span><span className="lc-recent__path">{shortPath(r.dir, L.home)}</span><span className="lc-recent__when">{whenAgo(r.at)}</span></button></li>)}</ul>
          : <p className="lc-muted">Projects you open show up here.</p>}
      </aside>
    </div>
  </div>;
}

const STATUS_GLYPH: Record<string, string> = { ok: '●', error: '✗', denied: '⊘', canceled: '⊘', running: '◌' };
function ToolRow({ it }: { it: Extract<Item, { kind: 'tool' }> }): React.JSX.Element {
  const arg = it.path ?? it.command ?? it.summary; const result = it.result?.split('\n').filter(Boolean)[0];
  return <div className={`lc-tool lc-tool--${it.status}`}>
    <span className="lc-tool__glyph" aria-hidden="true">{STATUS_GLYPH[it.status] ?? '●'}</span>
    <span className="lc-tool__body"><span className="lc-tool__line"><strong className="lc-tool__name">{it.name}</strong><span className="lc-tool__arg">{arg}</span><span className="cc-vh"> · {it.status}</span></span>
      {result ? <span className="lc-tool__result">{result}</span> : null}
      {it.diff && it.status === 'ok' ? <details className="lc-tool__details"><summary>Show the change</summary><Diff diff={it.diff} max={24} /></details> : null}</span>
  </div>;
}
function Turn({ it }: { it: Item }): React.JSX.Element | null {
  switch (it.kind) {
    case 'user': return <div className="lc-turn lc-turn--user"><span className="lc-who">you</span><div className="lc-body lc-plain">{it.text}</div></div>;
    case 'assistant': return <div className="lc-turn lc-turn--agent"><span className="lc-avatar"><CentoMark size={22} /></span><div className="lc-body"><Markdown text={it.text} />{it.done ? null : <span className="lc-caret" aria-hidden="true">▍</span>}</div></div>;
    case 'thinking': return <div className="lc-think">{it.done ? `∴ thought for ${Math.max(1, Math.round((it.ms || 0) / 1000))}s` : '∴ thinking… '}{it.done ? null : <span className="lc-caret" aria-hidden="true">▍</span>}</div>;
    case 'tool': return <ToolRow it={it} />;
    case 'notice': return <div className={`lc-note lc-note--${it.level}`}><strong>{it.text}</strong>{it.detail ? <span>{it.detail}</span> : null}</div>;
    default: return null;
  }
}
const RISK_LABEL: Record<string, string> = { high: 'high risk', medium: 'medium risk', low: 'low risk' };
function approvalTitle(tool: string): string { return tool === 'Bash' ? 'Allow Cento to run a command?' : ['Edit', 'MultiEdit', 'NotebookEdit'].includes(tool) ? 'Allow Cento to edit a file?' : tool === 'Write' ? 'Allow Cento to create a file?' : `Allow Cento to use ${tool}?`; }

function Workspace({ view, send }: { view: LocalView; send: Send }): React.JSX.Element {
  const [text, setText] = useState(''); const [effort, setEffort] = useState(''); const s = view.state; const model = view.models.find((x) => x.id === s?.settings?.model) ?? view.models.find((x) => x.isDefault);
  useEffect(() => { send({ t: 'models' }); }, [send, view.opened]); const approval = s?.approvals[0];
  const submit = (): void => { const t = text.trim(); if (!t) return; send({ t: 'submit', text: t }); setText(''); };
  const log = useRef<HTMLDivElement>(null); const stick = useRef(true);
  useEffect(() => { const el = log.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [view.items, approval]);
  const busy = !!s?.busy;
  return <div className="lc-ws" aria-label={view.opened ? shortPath(view.opened, view.launcher?.home ?? '') : 'Session'}>
    <header className="lc-wshead">
      <div className="lc-wshead__title"><h2>{view.opened ? baseName(view.opened) : 'Session'}</h2><span className="lc-wshead__path">{view.opened ? shortPath(view.opened, view.launcher?.home ?? '') : ''}</span></div>
      <div className="lc-wshead__chips"><Chip tone={busy ? 'warning' : 'success'}>{busy ? s?.verb || 'working' : 'ready'}</Chip>{s?.branch ? <Chip>{s.branch}</Chip> : null}{s?.engineLabel ? <Chip>{s.engineLabel}</Chip> : null}</div>
      <span className="lc-grow" /><Button variant="ghost" onClick={() => send({ t: 'compact' })}>Compact</Button><Button variant="ghost" onClick={() => send({ t: 'close' })}>Close project</Button>
    </header>
    <div className="lc-toolbar">
      <label className="lc-sel"><span>Mode</span><select aria-label="Mode" value={s?.settings?.permissionMode ?? 'default'} onChange={(e) => send({ t: 'setMode', mode: e.target.value as never })}><option value="default">Ask first</option><option value="acceptEdits">Accept edits</option><option value="plan">Plan (read only)</option><option value="bypassPermissions">Skip approvals</option></select></label>
      {view.models.length ? <label className="lc-sel"><span>Model</span><select aria-label="Model" value={s?.settings?.model ?? ''} onChange={(e) => send({ t: 'setModel', id: e.target.value })}><option value="">Default</option>{view.models.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label> : null}
      {model?.efforts?.length ? <label className="lc-sel"><span>Effort</span><select aria-label="Effort" value={effort} onChange={(e) => { setEffort(e.target.value); send({ t: 'setEffort', effort: e.target.value }); }}><option value="">Default ({model.defaultEffort ?? 'auto'})</option>{model.efforts.map((x) => <option key={x} value={x}>{x}</option>)}</select></label> : null}
    </div>
    {view.notice ? <Banner tone={view.notice.level === 'error' ? 'danger' : view.notice.level === 'warn' ? 'warning' : 'info'}>{view.notice.text}</Banner> : null}
    <div className="lc-log" role="log" aria-label="Transcript" ref={log} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      {view.items.length ? view.items.map((it) => <Turn key={it.id} it={it} />) : <div className="lc-empty"><CentoMark size={48} /><p>Ask the agent what to do in this project.</p></div>}
    </div>
    {approval ? <section className={`lc-approval lc-approval--${approval.risk}`} role="alertdialog" aria-label="Approval needed">
      <header className="lc-approval__head"><span className={`lc-risk lc-risk--${approval.risk}`}>{RISK_LABEL[approval.risk] ?? approval.risk}</span><h3>{approvalTitle(approval.tool)}</h3></header>
      <p className="lc-approval__what"><strong>{approval.agentName}</strong> wants to use <code>{approval.tool}</code>: {approval.summary}</p>
      {approval.command ? <pre className="lc-pre lc-pre--cmd">{approval.command}</pre> : null}
      {approval.diff ? <Diff diff={approval.diff} /> : null}
      <div className="lc-approval__btns"><Button variant="primary" onClick={() => send({ t: 'approve', decision: 'approve' })}>Allow once</Button>{approval.risk === 'high' ? null : <><Button onClick={() => send({ t: 'approve', decision: 'approve', scope: 'session' })}>Allow for this session</Button><Button onClick={() => send({ t: 'approve', decision: 'approve', scope: 'always' })}>Always allow in this project</Button></>}<Button variant="danger" onClick={() => send({ t: 'approve', decision: 'deny' })}>Deny</Button></div>
    </section> : null}
    <div className="lc-composer-box">
      <label className="cc-vh" htmlFor="lc-composer">Message</label>
      <textarea id="lc-composer" className="lc-composer" rows={2} value={text} placeholder="Ask the agent… (Ctrl+Enter sends)" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }} />
      <div className="lc-composer-bar"><span className="lc-hint">Ctrl+Enter to send</span><span className="lc-grow" /><Button disabled={!busy} onClick={() => send({ t: 'interrupt' })}>Stop</Button><Button variant={approval ? 'secondary' : 'primary'} disabled={!text.trim()} onClick={submit}>Send</Button></div>
    </div>
  </div>;
}
export function LocalPage(): React.JSX.Element {
  const { view, send, available } = useLocal();
  if (!available) return <Card title="Local agent"><EmptyState title="Only in the desktop app">Running an agent on this computer needs the Centcom desktop app.</EmptyState></Card>;
  if (!view.launcher) return <Skeleton lines={4} />;
  return view.opened ? <Workspace view={view} send={send} /> : <Picker view={view} send={send} />;
}
export const routeModule: RouteModule = { routes: [createRoute({ getParentRoute: () => rootRoute, path: '/local', component: LocalPage })], nav: [{ id: 'local', labelKey: 'nav.local', to: '/local', icon: 'home' }] };
export default routeModule;
