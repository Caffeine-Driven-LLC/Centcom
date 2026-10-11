import { useNavigate } from '@tanstack/react-router';
import { FolderGit2, History, Plus, Search } from 'lucide-react';
import React from 'react';
import { cn } from '../ui/shadcn/index.js';
import { shortPath, pickEngine, whenAgo, type LocalView } from './model.js';
import { useLocal } from './use-local.js';
import type { ClientMsg } from '../../../desktop/src/local/protocol.js';

const baseName = (p: string): string => p.replace(/\/+$/, '').split('/').pop() || p;

/** A live status dot: calm green when ready, a pulse while the agent works, amber when it waits for you. */
export function StatusDot({ view }: { view: LocalView }): React.JSX.Element {
  const waiting = (view.state?.approvals.length ?? 0) > 0; const busy = !!view.state?.busy;
  return <span role="img" aria-label={waiting ? 'needs you' : busy ? 'working' : 'ready'} className={cn('size-2 shrink-0 rounded-full', waiting ? 'bg-warning' : busy ? 'animate-pulse bg-primary' : 'bg-success')} />;
}

/** The sidebar of the desktop app: new session, the live session, this folder's saved sessions and the recent projects. */
export function SessionSidebar({ onNavigate, onSearch }: { onNavigate(): void; onSearch(): void }): React.JSX.Element | null {
  const { view, send, available } = useLocal(); const navigate = useNavigate(); const L = view.launcher;
  if (!available || !L) return null;
  const go = (m: ClientMsg): void => { send(m); onNavigate(); void navigate({ to: '/local' as never }); };
  const pick = pickEngine(L); const saved = (view.state?.sessions ?? []).filter((s) => s.id !== view.state?.sessionId).slice(0, 5);
  const others = L.recent.filter((r) => r.dir !== view.opened).slice(0, 6); const row = 'flex w-full border-0 bg-transparent [font:inherit] min-w-0 cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';
  return <div className="flex flex-col gap-1">
    <div className="flex gap-1.5">
      <button type="button" className="flex h-9 flex-1 cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 text-sm font-medium text-foreground hover:bg-accent" onClick={() => go({ t: 'close' })}><Plus className="size-4" aria-hidden="true" />New session</button>
      <button type="button" aria-label="Search and commands (Ctrl+K)" title="Search and commands (Ctrl+K)" className="flex size-9 cursor-pointer items-center justify-center rounded-md border border-input bg-card text-muted-foreground hover:bg-accent hover:text-foreground" onClick={onSearch}><Search className="size-4" aria-hidden="true" /></button>
    </div>
    {view.opened ? <>
      <h3 className="mt-3 px-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Active now</h3>
      <button type="button" aria-current="true" className={cn(row, 'bg-secondary text-foreground hover:bg-secondary')} onClick={() => { onNavigate(); void navigate({ to: '/local' as never }); }}>
        <StatusDot view={view} /><span className="min-w-0 flex-1 truncate">{baseName(view.opened)}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{view.state?.busy ? 'working' : (view.state?.approvals.length ?? 0) > 0 ? 'needs you' : 'ready'}</span>
      </button>
    </> : null}
    {saved.length ? <>
      <h3 className="mt-3 px-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">In {baseName(view.opened ?? '')}</h3>
      {saved.map((s) => <button key={s.id} type="button" className={row} title={s.title} onClick={() => go({ t: 'open', dir: view.opened!, engine: pick.engine, demo: !!view.state?.demo, resume: s.id })}><History className="size-3.5 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{s.title || 'Untitled'}</span><span className="shrink-0 text-xs">{whenAgo(s.updatedAt)}</span></button>)}
    </> : null}
    {others.length ? <>
      <h3 className="mt-3 px-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Recent projects</h3>
      {others.map((r) => <button key={r.dir} type="button" className={row} title={shortPath(r.dir, L.home)} onClick={() => go({ t: 'open', dir: r.dir, engine: pick.engine, demo: pick.demo })}><FolderGit2 className="size-3.5 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{baseName(r.dir)}</span><span className="shrink-0 text-xs">{whenAgo(r.at)}</span></button>)}
    </> : null}
  </div>;
}
