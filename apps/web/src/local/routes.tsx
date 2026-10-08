import { createRoute } from '@tanstack/react-router';
import React, { useEffect, useState } from 'react';
import { rootRoute } from '../app/root.js';
import type { RouteModule } from '../app/types.js';
import { Banner, Button, Card, Chip, EmptyState, Input, Skeleton } from '../ui/index.js';
import { engineStatus, pickEngine, shortPath, type LocalView } from './model.js';
import { useLocal } from './use-local.js';
import type { ClientMsg } from '../../../desktop/src/local/protocol.js';
import './local.css';

type Send = (m: ClientMsg) => void;
function Picker({ view, send }: { view: LocalView; send: Send }): React.JSX.Element {
  const L = view.launcher!; const d = view.dir; const initial = pickEngine(L);
  const [engine, setEngine] = useState(initial.engine); const [demo, setDemo] = useState(initial.demo); const [typed, setTyped] = useState('');
  useEffect(() => { if (!d) send({ t: 'browse', path: L.cwd }); }, [d, L.cwd, send]);
  useEffect(() => { if (d) setTyped(d.path); }, [d]);
  const st = engineStatus(L, engine);
  return <Card title="Open a project"><div className="lc-grid">
    <Banner tone={st.ok || demo ? 'info' : 'warning'}>{demo ? 'Demo agent: nothing real runs.' : st.text}</Banner>
    <div className="lc-row">
      <Button variant="secondary" aria-pressed={engine === 'claude-code'} onClick={() => setEngine('claude-code')}>Claude Code</Button>
      <Button variant="secondary" aria-pressed={engine === 'codex'} onClick={() => setEngine('codex')}>Codex</Button>
      <label className="lc-row"><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> Demo agent</label>
    </div>
    <form className="lc-row" onSubmit={(e) => { e.preventDefault(); send({ t: 'browse', path: typed }); }}><div className="lc-grow"><Input label="Folder" value={typed} onChange={(e) => setTyped(e.target.value)} /></div><Button type="submit">Go</Button></form>
    {d?.error ? <Banner tone="danger">{d.error}</Banner> : null}
    <div className="lc-dirs" role="list" aria-label="Folders">
      {d?.parent ? <button className="lc-dir" role="listitem" onClick={() => send({ t: 'browse', path: d.parent! })}>..</button> : null}
      {d?.entries.map((e) => <button key={e.name} className="lc-dir" role="listitem" onClick={() => send({ t: 'browse', path: `${d.path}/${e.name}` })}>{e.name}{e.git ? '  · git' : ''}</button>)}
    </div>
    <div className="lc-row"><Button variant="primary" disabled={!d || !!d.error} onClick={() => d && send({ t: 'open', dir: d.path, demo, engine })}>Open {d ? shortPath(d.path, L.home) : ''}</Button>{d?.saved ? <Chip>{d.saved} saved sessions</Chip> : null}</div>
    {L.recent.length ? <div><h3>Recent</h3><div className="lc-row">{L.recent.map((r) => <Button key={r.dir} variant="ghost" onClick={() => send({ t: 'open', dir: r.dir, demo, engine })}>{shortPath(r.dir, L.home)}</Button>)}</div></div> : null}
  </div></Card>;
}
function Workspace({ view, send }: { view: LocalView; send: Send }): React.JSX.Element {
  const [text, setText] = useState(''); const [effort, setEffort] = useState(''); const s = view.state; const model = view.models.find((x) => x.id === s?.settings?.model) ?? view.models.find((x) => x.isDefault);
  useEffect(() => { send({ t: 'models' }); }, [send, view.opened]); const approval = s?.approvals[0];
  const submit = (): void => { const t = text.trim(); if (!t) return; send({ t: 'submit', text: t }); setText(''); };
  return <Card title={view.opened ? shortPath(view.opened, view.launcher?.home ?? '') : 'Session'}><div className="lc-grid">
    <div className="lc-row"><Chip tone={s?.busy ? 'warning' : 'success'}>{s?.busy ? s.verb || 'working' : 'ready'}</Chip>{s?.branch ? <Chip>{s.branch}</Chip> : null}{s?.engineLabel ? <Chip>{s.engineLabel}</Chip> : null}<span className="lc-grow" /><Button variant="ghost" onClick={() => send({ t: 'compact' })}>Compact</Button><Button variant="ghost" onClick={() => send({ t: 'close' })}>Close project</Button></div>
    <div className="lc-row">
      <label className="lc-row">Mode <select aria-label="Mode" value={s?.settings?.permissionMode ?? 'default'} onChange={(e) => send({ t: 'setMode', mode: e.target.value as never })}><option value="default">Ask first</option><option value="acceptEdits">Accept edits</option><option value="plan">Plan (read only)</option><option value="bypassPermissions">Bypass (no asking)</option></select></label>
      {view.models.length ? <label className="lc-row">Model <select aria-label="Model" value={s?.settings?.model ?? ''} onChange={(e) => send({ t: 'setModel', id: e.target.value })}><option value="">Default</option>{view.models.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label> : null}
      {model?.efforts?.length ? <label className="lc-row">Effort <select aria-label="Effort" value={effort} onChange={(e) => { setEffort(e.target.value); send({ t: 'setEffort', effort: e.target.value }); }}><option value="">Default ({model.defaultEffort ?? 'auto'})</option>{model.efforts.map((x) => <option key={x} value={x}>{x}</option>)}</select></label> : null}
    </div>
    {view.notice ? <Banner tone={view.notice.level === 'error' ? 'danger' : view.notice.level === 'warn' ? 'warning' : 'info'}>{view.notice.text}</Banner> : null}
    <div className="lc-log" role="log" aria-label="Transcript">{view.items.map((it) => it.kind === 'user' ? <div key={it.id} className="lc-msg lc-user">{it.text}</div> : it.kind === 'assistant' ? <div key={it.id} className="lc-msg">{it.text}</div> : it.kind === 'thinking' ? <div key={it.id} className="lc-msg lc-tool">thinking… {it.done ? '' : '▍'}</div> : it.kind === 'tool' ? <div key={it.id} className="lc-msg lc-tool">{it.name} · {it.summary} · {it.status}{it.diff ? <pre className="lc-diff">{it.diff}</pre> : null}</div> : <div key={it.id} className="lc-msg lc-tool">{it.text}</div>)}</div>
    {approval ? <div className="lc-approval" role="alertdialog" aria-label="Approval needed"><p><strong>{approval.agentName}</strong> wants to use <code>{approval.tool}</code>: {approval.summary}</p>{approval.command ? <pre className="lc-diff">{approval.command}</pre> : null}{approval.diff ? <pre className="lc-diff">{approval.diff}</pre> : null}<div className="lc-row"><Button onClick={() => send({ t: 'approve', decision: 'approve' })}>Allow once</Button><Button onClick={() => send({ t: 'approve', decision: 'approve', scope: 'session' })}>Allow for this session</Button><Button variant="danger" onClick={() => send({ t: 'approve', decision: 'deny' })}>Deny</Button></div></div> : null}
    <label className="cc-vh" htmlFor="lc-composer">Message</label>
    <textarea id="lc-composer" className="lc-composer" value={text} placeholder="Ask the agent… (Ctrl+Enter sends)" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }} />
    <div className="lc-row"><Button variant="primary" disabled={!text.trim()} onClick={submit}>Send</Button><Button disabled={!s?.busy} onClick={() => send({ t: 'interrupt' })}>Stop</Button></div>
  </div></Card>;
}
export function LocalPage(): React.JSX.Element {
  const { view, send, available } = useLocal();
  if (!available) return <Card title="Local agent"><EmptyState title="Only in the desktop app">Running an agent on this computer needs the Centcom desktop app.</EmptyState></Card>;
  if (!view.launcher) return <Skeleton lines={4} />;
  return view.opened ? <Workspace view={view} send={send} /> : <Picker view={view} send={send} />;
}
export const routeModule: RouteModule = { routes: [createRoute({ getParentRoute: () => rootRoute, path: '/local', component: LocalPage })], nav: [{ id: 'local', labelKey: 'nav.local', to: '/local', icon: 'home' }] };
export default routeModule;
