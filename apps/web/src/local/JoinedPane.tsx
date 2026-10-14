import { ArrowUp, LogOut, Users } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/shadcn/index.js';
import { Markdown } from './Markdown.js';
import { Person } from './SessionPanel.js';
import type { LocalView } from './model.js';
import type { ClientMsg } from '../../../desktop/src/local/protocol.js';
import './shell.css';

const ROLE = { host: 'host', editor: 'can edit', viewer: 'view only' } as const;
const HOW = { invite: 'by invite', session: 'in your workspace', watch: 'watch-only link' } as const;

/** Somebody else's session: its transcript as it happens, the people in it, and (for an editor) a box that asks the host's agent. */
export function JoinedPane({ view, send }: { view: LocalView; send(m: ClientMsg): void }): React.JSX.Element | null {
  const j = view.joined; const [text, setText] = useState(''); const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [j?.entries.length, j?.entries.at(-1)?.text.length]);
  if (!j) return null;
  const leave = (): void => send({ t: 'joinedLeave' }); const can = j.role === 'editor' || j.role === 'host';
  const ask = (): void => { const t = text.trim(); if (!t || !j.payer) return; send({ t: 'joinedAsk', text: t }); setText(''); };
  if (j.state === 'joining') return <div className="lc-home"><p>Joining…</p></div>;
  if (j.state === 'failed') return <div className="lc-home jn__fail"><h2 className="acct__title">Could not join</h2><p role="alert" className="acct__error">{j.error}</p><Button onClick={leave}>Back</Button></div>;
  return <div className="lc-split" data-panel="true"><div className="lc-ws" aria-label="Shared session">
    <header className="lc-wshead"><div className="lc-wshead__title"><h2>Shared session</h2><span className="lc-wshead__path">{j.how ? HOW[j.how] : ''}{j.role ? ` · ${ROLE[j.role]}` : ''}</span></div><span className="lc-grow" />
      {j.phase === 'waiting_for_key' ? <span className="acct__note">Waiting for the host to let you read…</span> : j.phase === 'reconnecting' ? <span className="acct__note">Reconnecting…</span> : null}
      <Button variant="ghost" size="sm" onClick={leave}><LogOut />Leave</Button></header>
    {j.state === 'ended' ? <div className="lc-banner" role="status">{j.error ?? 'This session has ended.'}</div> : null}
    <div className="lc-log jn__log" role="log" aria-live="polite">
      {j.entries.length === 0 ? <p className="acct__note">Nothing yet. What the host's agent does shows up here.</p> : null}
      {j.entries.map((e) => e.kind === 'user' ? <div key={e.id} className="lc-turn lc-turn--user"><div className="lc-bubble"><span className="jn__who">{e.who ?? 'Someone'}</span>{e.text}</div></div>
        : e.kind === 'assistant' ? <div key={e.id} className="lc-turn lc-turn--agent"><div className="lc-body"><Markdown text={e.text} /></div></div>
        : <p key={e.id} className="jn__line" data-kind={e.kind} data-status={e.status}>{e.kind === 'tool' ? '› ' : e.kind === 'approval' ? '⚑ ' : ''}{e.text}{e.kind === 'approval' ? ` (${e.status === 'waiting' ? 'waiting for the host' : e.status})` : ''}</p>)}
      <div ref={end} />
    </div>
    {j.asked.length ? <ul className="jn__asked" aria-label="Waiting for the host">{j.asked.map((a) => <li key={a.item}>{a.state === 'queued' ? 'Waiting for the host: ' : 'Running: '}{a.text}</li>)}</ul> : null}
    <div className="lc-composer">{can ? <>{j.payer ? <p className="acct__note jn__payer" data-testid="guest-notice">Your prompt will run on {j.payer}'s account</p> : <p className="acct__note jn__payer" role="status">Finding out whose account would run your prompt…</p>}<textarea aria-label="Ask the host's agent" rows={2} placeholder="Ask for something… the host decides whether it runs" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(); } }} /><div className="lc-composer-bar"><span className="lc-hint">Enter to ask</span><span className="lc-grow" /><Button size="sm" disabled={!text.trim() || !j.payer} onClick={ask}><ArrowUp />Ask</Button></div></> : <p className="acct__note">You can watch this session but not send to it.</p>}</div>
  </div>
  <aside className="ps" aria-label="People"><section className="ps-sec"><h3 className="ps-h"><Users aria-hidden="true" />People</h3><ul className="ps-list">{j.people.map((p) => <Person key={p.id} name={p.you ? 'You' : p.name} slot={p.slot} sub={`${ROLE[p.role]}${p.online ? '' : ' · away'}`} />)}</ul></section></aside></div>;
}
