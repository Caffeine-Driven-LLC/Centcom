import { useRouter } from '@tanstack/react-router';
import { CheckCircle2, Circle, CircleDot, FileDiff, Gauge, ListChecks, UserPlus, Users } from 'lucide-react';
import React, { useState } from 'react';
import { Avatar, Badge, Button } from '../ui/shadcn/index.js';
import { Diff } from './Diff.js';
import { compactNumber, duration, insights, money } from './insights.js';
import type { LocalView } from './model.js';
import './shell.css';

export function Person({ name, slot, sub, you }: { name: string; slot: number; sub?: string; you?: boolean }): React.JSX.Element {
  return <li className="ps-person">
    <Avatar name={name} slot={slot} />
    <span className="ps-person__text"><span className="ps-person__name">{name}{you ? ' (you)' : ''}</span>{sub ? <span className="ps-person__sub">{sub}</span> : null}</span>
  </li>;
}
function Section({ icon, title, aside, children }: { icon: React.ReactNode; title: string; aside?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return <section className="ps-sec"><h3 className="ps-sec__title">{icon}{title}<span className="ps-sec__aside">{aside}</span></h3>{children}</section>;
}
const baseName = (p: string): string => p.split('/').pop() || p;
const pct = (u: number): number => (u <= 1 ? u * 100 : u);

/** The session at a glance: progress, context use, who is in it, and what it changed. Everything is counted from the live transcript and agent state. */
export function SessionPanel({ view, now = Date.now() }: { view: LocalView; now?: number }): React.JSX.Element {
  const [openFile, setOpenFile] = useState<string | null>(null); const router = useRouter({ warn: false }) as { navigate(o: { to: string }): unknown } | undefined;
  const s = view.state; const info = insights(view.items, s, now); const agents = s?.agents ?? []; const limits = s?.limits ?? [];
  const rel = (p: string): string => (view.opened && p.startsWith(view.opened + '/') ? p.slice(view.opened.length + 1) : p);
  const waiting = (s?.approvals.length ?? 0) > 0; const shown = info.files.find((f) => f.path === openFile);
  return <aside className="lc-side" aria-label="Session details">
    <Section icon={<CircleDot />} title="Status" aside={info.elapsedS !== undefined ? duration(info.elapsedS) : undefined}>
      <div className="ps-chips">
        <Badge variant={waiting ? 'warning' : s?.busy ? 'primary' : 'success'}>{waiting ? 'Needs you' : s?.busy ? s.verb || 'Working' : 'Ready'}</Badge>
        {s?.branch ? <Badge variant="outline">{s.branch}</Badge> : null}
        {s?.engineLabel ? <Badge variant="outline">{s.engineLabel}</Badge> : null}
      </div>
      <dl className="ps-stats">
        {[[info.steps, 'steps'], [info.files.length, 'files'], [info.failed, 'failed']].map(([n, l]) => <div key={String(l)} className="ps-stat"><dt>{l}</dt><dd>{n}</dd></div>)}
      </dl>
    </Section>
    {info.context !== undefined || info.tokens > 0 ? <Section icon={<Gauge />} title="Context" aside={info.context !== undefined ? `${Math.round(info.context)}%` : undefined}>
      {info.context !== undefined ? <progress className="lc-meter" data-level={info.context >= 85 ? 'high' : info.context >= 65 ? 'mid' : 'low'} value={info.context} max={100} aria-label="Context used" /> : null}
      <p className="ps-note">{compactNumber(info.tokens)} tokens · {money(info.cost)} this session{info.context !== undefined && info.context >= 85 ? ' · compact soon' : ''}</p>
      {limits.map((l) => <div key={l.name} className="ps-limit"><div><span>{l.name}</span><span>{Math.round(pct(l.utilization))}%</span></div><progress className="lc-meter" data-level={pct(l.utilization) >= 85 ? 'high' : 'low'} value={pct(l.utilization)} max={100} aria-label={`${l.name} used`} /></div>)}
    </Section> : null}
    {info.plan.total ? <Section icon={<ListChecks />} title="Plan" aside={`${info.plan.done}/${info.plan.total}`}>
      <progress className="lc-meter" data-level="low" value={info.plan.done} max={info.plan.total} aria-label="Plan progress" />
      <ul className="ps-list">{(s?.tasks ?? []).slice(0, 8).map((t) => <li key={t.id} className="ps-task" data-status={t.status}>
        {t.status === 'completed' ? <CheckCircle2 aria-label="done" /> : t.status === 'in_progress' ? <CircleDot aria-label="in progress" /> : <Circle aria-label="to do" />}<span>{t.text}</span></li>)}</ul>
    </Section> : null}
    <Section icon={<Users />} title="People and agents">
      <ul className="ps-list">
        <Person name="You" slot={0} sub="on this computer" />
        {info.people.map((p) => <Person key={p.name} name={p.name} slot={p.slot} sub={`${p.messages} message${p.messages === 1 ? '' : 's'}`} />)}
        {agents.map((a) => <li key={a.id} className="ps-person"><span className="ps-agent" data-busy={a.busy} aria-hidden="true">◆</span><span className="ps-person__text"><span className="ps-person__name">{a.name}</span><span className="ps-person__sub">{a.model || a.engine} · {a.busy ? a.state : 'idle'}{a.cost > 0 ? ` · ${money(a.cost)}` : ''}</span></span></li>)}
      </ul>
      {info.people.length === 0 ? <p className="ps-note">Only you so far. Invite someone to watch or help in this session.</p> : null}
      <Button variant="outline" size="sm" onClick={() => { void router?.navigate({ to: '/workspaces' }); }}><UserPlus />Invite someone</Button>
    </Section>
    <Section icon={<FileDiff />} title="Files changed" aside={info.files.length ? <><span className="ps-add">+{info.added}</span> <span className="ps-del">−{info.removed}</span></> : undefined}>
      {shown?.diff ? <div className="ps-diff"><Button variant="ghost" size="sm" onClick={() => setOpenFile(null)}>← All files</Button><p className="ps-diff__path" title={shown.path}>{rel(shown.path)}</p><Diff diff={shown.diff} max={60} /></div>
        : info.files.length ? <ul className="ps-list ps-list--tight">{info.files.slice(0, 12).map((f) => <li key={f.path}><button type="button" disabled={!f.diff} className="ps-file" title={f.path} onClick={() => setOpenFile(f.path)}><span className="ps-file__name" data-failed={f.failed}>{rel(f.path)}</span><span className="ps-file__n">{f.added || f.removed ? `+${f.added} −${f.removed}` : `${f.edits}×`}</span></button></li>)}{info.files.length > 12 ? <li className="ps-more">and {info.files.length - 12} more</li> : null}</ul>
        : <p className="ps-note">Nothing changed yet in {baseName(view.opened ?? 'this project')}.</p>}
    </Section>
  </aside>;
}
