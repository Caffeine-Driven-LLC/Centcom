import { AlertTriangle, GitBranch, Lock, Send, Users } from 'lucide-react';
import React from 'react';
import { Avatar, Badge, Button } from '../ui/shadcn/index.js';
import type { LocalView } from './model.js';
import type { ClientMsg } from '../../../desktop/src/local/protocol.js';
import './shell.css';

const STATE: Record<string, string> = { thinking: 'working', 'awaiting-approval': 'waiting for its owner', idle: 'idle', exited: 'left', crash: 'crashed', away: 'away' };
const how = (p?: string, label?: string): string => (p === 'anthropic' ? 'Claude Code' : p === 'openai' ? 'Codex' : label ?? 'Agent');

/** Branch mode: everybody's agents, live: state, branch, how far from the base, the files each has open, and what it last said. */
export function TeamSection({ view, send }: { view: LocalView; send(m: ClientMsg): void }): React.JSX.Element | null {
  const sh = view.sharing; const team = sh?.team; if (!sh || sh.mode !== 'branch' || !team) return null;
  const others = team.members.filter((m) => !m.you);
  return <section className="ps-sec ps-team" aria-label="Team">
    <h3 className="ps-sec__title"><Users />Team<span className="ps-sec__aside">{team.members.reduce((n, m) => n + m.agents.filter((a) => !a.exit).length, 0)} agents</span></h3>
    {team.conflicts.length ? <div className="ps-conflict" role="alert"><AlertTriangle aria-hidden="true" /><span>{team.conflicts.map((c) => `Two agents are changing ${c.paths.join(', ') || 'the same file'}.`).join(' ')} Your branches will conflict there.</span></div> : null}
    <ul className="ps-list">{team.members.map((m) => <li key={m.id} className="ps-member">
      <div className="ps-person"><Avatar name={m.name} slot={m.slot} /><span className="ps-person__text"><span className="ps-person__name">{m.you ? 'You' : m.name}</span><span className="ps-person__sub">{m.role === 'host' ? 'host' : m.role === 'editor' ? 'editor' : 'viewer'}{m.online ? '' : ' · away'}</span></span></div>
      {m.agents.length === 0 ? <p className="ps-note">No agent here.</p> : m.agents.map((a) => <div key={a.id} className="ps-tagent" data-state={a.state}>
        <div className="ps-tagent__head"><span className="ps-agent" data-busy={a.state === 'thinking'} aria-hidden="true">◆</span><strong>{how(a.provider, a.label)}</strong><Badge>{STATE[a.state] ?? a.state.replace(/-/g, ' ')}</Badge></div>
        {a.branch ? <p className="ps-tagent__line"><GitBranch aria-hidden="true" />{a.branch}{a.ahead !== undefined || a.behind !== undefined ? ` · ${a.ahead ?? 0} ahead, ${a.behind ?? 0} behind${a.dirty ? ', changes' : ''}` : ''}</p> : null}
        {a.locks.length ? <p className="ps-tagent__line"><Lock aria-hidden="true" />{a.locks.map((l) => l.path ?? 'a file').join(', ')}</p> : null}
        {a.lastSaid ? <p className="ps-tagent__said">{a.lastSaid}</p> : !a.exit && !a.sharing ? <p className="ps-note">Activity not shared.</p> : null}
      </div>)}
    </li>)}</ul>
    {team.hints.map((h) => <p key={h} className="ps-note">{h}</p>)}
    {team.handoffs.filter((h) => h.state === 'offered').map((h) => { const me = team.members.find((m) => m.you); const mine = h.to === me?.id; const from = team.members.find((m) => m.id === h.from)?.name ?? 'Someone'; return <div key={h.id} className="ps-handoff"><Send aria-hidden="true" /><span>{mine ? `${from} offers you their work${h.note ? `: ${h.note}` : ''}` : `Work offered to ${team.members.find((m) => m.id === h.to)?.name ?? 'someone'}`}</span>{mine ? <span className="shr__btns"><Button size="sm" onClick={() => send({ t: 'shareHandoffAnswer', id: h.id, accept: true })}>Accept</Button><Button size="sm" variant="ghost" onClick={() => send({ t: 'shareHandoffAnswer', id: h.id, accept: false })}>Decline</Button></span> : null}</div>; })}
    {others.length ? <details className="ps-handoffpick"><summary>Hand my work to someone</summary><div className="ps-handoffpick__row">{others.map((m) => <Button key={m.id} variant="outline" size="sm" onClick={() => send({ t: 'shareHandoff', to: m.id })}>{m.name}</Button>)}</div></details> : null}
  </section>;
}
