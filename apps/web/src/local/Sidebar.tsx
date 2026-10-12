import { useNavigate } from '@tanstack/react-router';
import { FolderGit2, History, Plus, Search, Users } from 'lucide-react';
import React from 'react';
import { isShown, runningWord, shortPath, pickEngine, whenAgo, type LocalView } from './model.js';
import { useLocal } from './use-local.js';
import type { ClientMsg } from '../../../desktop/src/local/protocol.js';
import { AccountChip } from './Account.js';
import { JoinDialog, openJoin } from './JoinDialog.js';
import './shell.css';

const baseName = (p: string): string => p.replace(/\/+$/, '').split('/').pop() || p;
const stateOf = (view: LocalView): 'waiting' | 'busy' | 'ready' => ((view.state?.approvals.length ?? 0) > 0 ? 'waiting' : view.state?.busy ? 'busy' : 'ready');
const STATE_WORD = { waiting: 'needs you', busy: 'working', ready: 'ready' } as const;

/** A live status dot: calm green when ready, a pulse while the agent works, amber when it waits for you. */
export function StatusDot({ view }: { view: LocalView }): React.JSX.Element {
  const st = stateOf(view);
  return <span role="img" aria-label={STATE_WORD[st]} className="sb__dot" data-state={st} />;
}

/** The sidebar of the desktop app: new session, the live session, this folder's saved sessions and the recent projects. */
export function SessionSidebar({ onNavigate, onSearch, newSession }: { onNavigate(): void; onSearch(): void; /** Filled with the "new session" action, so Ctrl+N can call it. */ newSession?: React.MutableRefObject<(() => void) | null> }): React.JSX.Element | null {
  const { view, send, available } = useLocal(); const navigate = useNavigate(); const L = view.launcher;
  const fresh = (): void => { send({ t: 'leave' }); onNavigate(); void navigate({ to: '/local' as never }); };
  React.useEffect(() => { if (!newSession) return; newSession.current = available ? fresh : null; return () => { newSession.current = null; }; }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!available || !L) return null;
  const go = (m: ClientMsg): void => { send(m); onNavigate(); void navigate({ to: '/local' as never }); };
  const pick = pickEngine(L); const saved = (view.state?.sessions ?? []).filter((s) => s.id !== view.state?.sessionId).slice(0, 5);
  const live = new Set(view.running.map((r) => r.dir)); const others = L.recent.filter((r) => r.dir !== view.opened && !live.has(r.dir)).slice(0, 6);
  return <div className="sb">
    <div className="sb__top">
      <button type="button" className="sb__new" onClick={fresh} title="New session (Ctrl+N)"><Plus aria-hidden="true" />New session</button>
      <button type="button" className="sb__icon" aria-label="Search and commands (Ctrl+K)" title="Search and commands (Ctrl+K)" onClick={onSearch}><Search aria-hidden="true" /></button>
    </div>
    {view.running.length || view.opened ? <>
      <h3 className="sb__head">Running</h3>
      {(view.running.length ? view.running : [{ dir: view.opened!, engine: pick.engine, demo: !!view.state?.demo, busy: !!view.state?.busy, waiting: view.state?.approvals.length ?? 0 }]).map((r) => {
        const shown = isShown(r, view);
        return <button key={`${r.dir}::${r.demo ? 'demo' : r.engine}`} type="button" aria-current={shown ? 'true' : undefined} className="sb__row" title={r.waiting > 0 && r.ask ? `${shortPath(r.dir, L.home)}\nWaiting for you: ${r.ask}` : shortPath(r.dir, L.home)} onClick={() => (shown ? (onNavigate(), void navigate({ to: '/local' as never })) : go({ t: 'open', dir: r.dir, engine: r.engine, demo: r.demo }))}>
          <span role="img" aria-label={runningWord(r)} className="sb__dot" data-state={r.waiting > 0 ? 'waiting' : r.busy ? 'busy' : 'ready'} /><span className="sb__name">{baseName(r.dir)}</span><span className="sb__when">{runningWord(r)}</span>
        </button>;
      })}
    </> : null}
    {saved.length ? <>
      <h3 className="sb__head">In {baseName(view.opened ?? '')}</h3>
      {saved.map((s) => <button key={s.id} type="button" className="sb__row" title={s.title} onClick={() => go({ t: 'open', dir: view.opened!, engine: pick.engine, demo: !!view.state?.demo, resume: s.id })}><History aria-hidden="true" /><span className="sb__name">{s.title || 'Untitled'}</span><span className="sb__when">{whenAgo(s.updatedAt)}</span></button>)}
    </> : null}
    {others.length ? <>
      <h3 className="sb__head">Recent projects</h3>
      {others.map((r) => <button key={r.dir} type="button" className="sb__row" title={shortPath(r.dir, L.home)} onClick={() => go({ t: 'open', dir: r.dir, engine: pick.engine, demo: pick.demo })}><FolderGit2 aria-hidden="true" /><span className="sb__name">{baseName(r.dir)}</span><span className="sb__when">{whenAgo(r.at)}</span></button>)}
    </> : null}
    <button type="button" className="sb__account" onClick={openJoin} title="Join a session someone shared with you"><Users aria-hidden="true" /><span className="sb__name">Join a session</span></button>
    <JoinDialog view={view} send={send} onJoin={() => { onNavigate(); void navigate({ to: '/local' as never }); }} />
    <AccountChip />
  </div>;
}
