import { useRouter } from '@tanstack/react-router';
import { CheckCircle2, Circle, CircleDot, FileDiff, Gauge, ListChecks, UserPlus, Users } from 'lucide-react';
import React, { useState } from 'react';
import { Diff } from './Diff.js';
import { Avatar, AvatarFallback, Badge, Button, cn } from '../ui/shadcn/index.js';
import { compactNumber, duration, insights, money } from './insights.js';
import type { LocalView } from './model.js';

/** One literal class per presence colour, so Tailwind can see them. */
const SLOT_BG = ['bg-[var(--presence-violet)]', 'bg-[var(--presence-red)]', 'bg-[var(--presence-yellow)]', 'bg-[var(--presence-green)]', 'bg-[var(--presence-brown)]'];
const SLOT_FG = ['text-white', 'text-white', 'text-black', 'text-black', 'text-white'];
const initial = (name: string): string => [...name.trim()][0]?.toUpperCase() ?? '?';
export function Person({ name, slot, sub, you }: { name: string; slot: number; sub?: string; you?: boolean }): React.JSX.Element {
  return <li className="flex items-center gap-2.5">
    <Avatar className="size-7"><AvatarFallback className={cn(SLOT_BG[slot % 5], SLOT_FG[slot % 5])}>{initial(name)}</AvatarFallback></Avatar>
    <span className="min-w-0 flex-1"><span className="block truncate text-sm text-foreground">{name}{you ? ' (you)' : ''}</span>{sub ? <span className="block truncate text-xs text-muted-foreground">{sub}</span> : null}</span>
  </li>;
}
function Section({ icon, title, aside, children }: { icon: React.ReactNode; title: string; aside?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return <section className="flex flex-col gap-2.5 border-b border-border px-4 py-4 last:border-b-0">
    <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase [&_svg]:size-3.5">{icon}{title}<span className="ml-auto font-normal tracking-normal normal-case">{aside}</span></h3>
    {children}
  </section>;
}
const baseName = (p: string): string => p.split('/').pop() || p;

/** The session at a glance: progress, context use, who is in it, and what it changed. Everything is counted from the live transcript and agent state. */
export function SessionPanel({ view, now = Date.now() }: { view: LocalView; now?: number }): React.JSX.Element {
  const [openFile, setOpenFile] = useState<string | null>(null); const router = useRouter({ warn: false }) as { navigate(o: { to: string }): unknown } | undefined; const s = view.state; const info = insights(view.items, s, now); const agents = s?.agents ?? []; const limits = s?.limits ?? [];
  const rel = (p: string): string => (view.opened && p.startsWith(view.opened + '/') ? p.slice(view.opened.length + 1) : p);
  const waiting = (s?.approvals.length ?? 0) > 0;
  return <aside className="lc-side" aria-label="Session details">
    <Section icon={<CircleDot />} title="Status" aside={info.elapsedS !== undefined ? duration(info.elapsedS) : undefined}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={waiting ? 'warning' : s?.busy ? 'primary' : 'success'}>{waiting ? 'Needs you' : s?.busy ? s.verb || 'Working' : 'Ready'}</Badge>
        {s?.branch ? <Badge variant="outline">{s.branch}</Badge> : null}
        {s?.engineLabel ? <Badge variant="outline">{s.engineLabel}</Badge> : null}
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[[info.steps, 'steps'], [info.files.length, 'files'], [info.failed, 'failed']].map(([n, l]) => <div key={String(l)} className="rounded-md bg-muted py-2"><dt className="text-xs text-muted-foreground">{l}</dt><dd className="m-0 text-lg font-semibold text-foreground tabular-nums">{n}</dd></div>)}
      </dl>
    </Section>
    {info.context !== undefined || info.tokens > 0 ? <Section icon={<Gauge />} title="Context" aside={info.context !== undefined ? `${Math.round(info.context)}%` : undefined}>
      {info.context !== undefined ? <progress className="lc-meter" data-level={info.context >= 85 ? 'high' : info.context >= 65 ? 'mid' : 'low'} value={info.context} max={100} aria-label="Context used" /> : null}
      <p className="m-0 text-xs text-muted-foreground">{compactNumber(info.tokens)} tokens · {money(info.cost)} this session{info.context !== undefined && info.context >= 85 ? ' · compact soon' : ''}</p>
      {limits.map((l) => <div key={l.name} className="flex flex-col gap-1"><div className="flex justify-between text-xs text-muted-foreground"><span>{l.name}</span><span>{Math.round(l.utilization * (l.utilization <= 1 ? 100 : 1))}%</span></div><progress className="lc-meter" data-level={l.utilization >= 0.85 || l.utilization >= 85 ? 'high' : 'low'} value={l.utilization <= 1 ? l.utilization * 100 : l.utilization} max={100} aria-label={`${l.name} used`} /></div>)}
    </Section> : null}
    {info.plan.total ? <Section icon={<ListChecks />} title="Plan" aside={`${info.plan.done}/${info.plan.total}`}>
      <progress className="lc-meter" data-level="low" value={info.plan.done} max={info.plan.total} aria-label="Plan progress" />
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">{(s?.tasks ?? []).slice(0, 8).map((t) => <li key={t.id} className={cn('flex items-start gap-2 text-sm', t.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground')}>
        {t.status === 'completed' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="done" /> : t.status === 'in_progress' ? <CircleDot className="mt-0.5 size-4 shrink-0 text-primary" aria-label="in progress" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="to do" />}<span>{t.text}</span></li>)}</ul>
    </Section> : null}
    <Section icon={<Users />} title="People and agents">
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        <Person name="You" slot={0} sub="on this computer" />
        {info.people.map((p) => <Person key={p.name} name={p.name} slot={p.slot} sub={`${p.messages} message${p.messages === 1 ? '' : 's'}`} />)}
        {agents.map((a) => <li key={a.id} className="flex items-center gap-2.5"><span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs', a.busy ? 'animate-pulse text-primary' : 'text-muted-foreground')} aria-hidden="true">◆</span><span className="min-w-0 flex-1"><span className="block truncate text-sm text-foreground">{a.name}</span><span className="block truncate text-xs text-muted-foreground">{a.model || a.engine} · {a.busy ? a.state : 'idle'}{a.cost > 0 ? ` · ${money(a.cost)}` : ''}</span></span></li>)}
      </ul>
      {info.people.length === 0 ? <p className="m-0 text-xs text-muted-foreground">Only you so far. Invite someone to watch or help in this session.</p> : null}
      <Button variant="outline" size="sm" className="self-start" onClick={() => { void router?.navigate({ to: '/workspaces' }); }}><UserPlus />Invite someone</Button>
    </Section>
    <Section icon={<FileDiff />} title="Files changed" aside={info.files.length ? <><span className="text-success">+{info.added}</span> <span className="text-destructive">−{info.removed}</span></> : undefined}>
      {openFile && info.files.find((f) => f.path === openFile)?.diff ? <div className="flex flex-col gap-2"><Button variant="ghost" size="sm" className="self-start" onClick={() => setOpenFile(null)}>← All files</Button><p className="m-0 truncate font-mono text-xs text-foreground" title={openFile}>{rel(openFile)}</p><Diff diff={info.files.find((f) => f.path === openFile)!.diff} max={60} /></div>
        : info.files.length ? <ul className="m-0 flex list-none flex-col gap-0.5 p-0">{info.files.slice(0, 12).map((f) => <li key={f.path}><button type="button" disabled={!f.diff} className="flex w-full cursor-pointer items-baseline gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-sm [font:inherit] enabled:hover:bg-accent disabled:cursor-default" title={f.path} onClick={() => setOpenFile(f.path)}><span className={cn('min-w-0 flex-1 truncate font-mono text-xs', f.failed ? 'text-destructive' : 'text-foreground')}>{rel(f.path)}</span><span className="shrink-0 text-xs text-muted-foreground tabular-nums">{f.added || f.removed ? `+${f.added} −${f.removed}` : `${f.edits}×`}</span></button></li>)}{info.files.length > 12 ? <li className="px-1.5 text-xs text-muted-foreground">and {info.files.length - 12} more</li> : null}</ul>
        : <p className="m-0 text-xs text-muted-foreground">Nothing changed yet in {baseName(view.opened ?? 'this project')}.</p>}
    </Section>
  </aside>;
}
