import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from '../a11y/motion.js';
import { Banner, Button, Card, Chip, EmptyState, Table } from '../ui/index.js';
import { MAX_ANIMATED, elapsed, middleTruncate, motionPlan, type Card as FleetCard } from './model.js';

/** Where the 36 px mascot goes (the player is lane C086). Until then it is a still slot that records the state and whether it may move. */
export const MascotThumb = ({ state, paused }: { state: string; paused: boolean }): React.JSX.Element => <span className="cc-mascot" data-mascot-slot data-state={state} data-paused={paused} aria-hidden="true" />;
export interface FleetActions { onOpen?(agentId: string): void; onMerge?(agentId: string, action: 'merge' | 'rebase' | 'open-pr'): void }
const SLOT_CLASS = ['0', '1', '2', '3', '4'];
function AgentCard({ c, now, plan, active, refCb, tabIndex, onKey, ...a }: { c: FleetCard; now: number; plan: ReturnType<typeof motionPlan>; active: boolean; refCb(el: HTMLElement | null): void; tabIndex: number; onKey(e: React.KeyboardEvent): void } & FleetActions): React.JSX.Element {
  const glow = plan.glow === c.agentId;
  return <article ref={refCb} tabIndex={tabIndex} onKeyDown={onKey} aria-label={`${c.label}, ${c.word}, ${c.ownerName}`} className={`cc-agent${glow ? ' cc-agent--glow' : ''}${active ? ' cc-agent--on' : ''}`} data-state={c.state}>
    <header><span className={`cc-avatar cc-avatar--${SLOT_CLASS[c.ownerSlot % 5]}`} aria-hidden="true">{[...c.ownerName][0]?.toUpperCase()}</span> <strong>{c.label}</strong> <span className="cc-help">{c.mine ? 'you' : c.ownerName}</span></header>
    <p><span aria-hidden="true">{c.glyph} </span><span>{c.word}</span>{c.since ? <span className="cc-help"> · {elapsed(c.since, now)}</span> : null} {c.needsYou ? <Chip tone="warning">Needs you</Chip> : null}{c.conflict ? <Chip tone="danger">! Conflict</Chip> : null}{c.locks ? <Chip>{c.locks === 1 ? '1 file locked' : `${c.locks} files locked`}</Chip> : null}</p>
    {c.branch ? <p className="cc-help" title="">{middleTruncate(c.branch)}{c.ahead !== undefined ? ` · ${c.ahead} ahead, ${c.behind ?? 0} behind${c.dirty ? ', changes not saved' : ''}` : ''}</p> : null}
    <MascotThumb state={c.state} paused={!plan.animated.has(c.agentId)} />
    <div>{c.mine && c.branch && c.ahead ? <><Button variant="ghost" onClick={() => a.onMerge?.(c.agentId, 'merge')}>Merge</Button><Button variant="ghost" onClick={() => a.onMerge?.(c.agentId, 'open-pr')}>Open pull request</Button></> : null}<Button variant="ghost" onClick={() => a.onOpen?.(c.agentId)}>Details</Button></div>
  </article>;
}
/** The board: cards in priority order, `j` and `k` (and the arrow keys) move between them, Enter opens the details. */
export function FleetBoard({ cards, now, view, onOpen, onMerge }: { cards: FleetCard[]; now: number; view: 'cards' | 'table' } & FleetActions): React.JSX.Element {
  const reduced = useReducedMotion(); const plan = useMemo(() => motionPlan(cards, reduced), [cards, reduced]); const els = useRef<(HTMLElement | null)[]>([]); const [cur, setCur] = useState(0); useEffect(() => { setCur((c) => Math.min(c, Math.max(0, cards.length - 1))); }, [cards.length]);
  if (!cards.length) return <EmptyState title="No agents yet">Agents appear here when someone in the session starts one.</EmptyState>;
  if (view === 'table') return <Table caption="Agents" rows={cards} rowKey={(c) => c.agentId} columns={[{ key: 'a', header: 'Agent', cell: (c) => c.label }, { key: 'o', header: 'Owner', cell: (c) => (c.mine ? 'you' : c.ownerName) }, { key: 's', header: 'State', cell: (c) => `${c.glyph} ${c.word}` }, { key: 'b', header: 'Branch', cell: (c) => (c.branch ? middleTruncate(c.branch) : '') }, { key: 't', header: 'Time', cell: (c) => elapsed(c.since, now) }]} />;
  const move = (i: number): void => { const n = Math.max(0, Math.min(cards.length - 1, i)); setCur(n); els.current[n]?.focus(); };
  return <div className="cc-fleet" role="list" aria-label="Agents">{cards.map((c, i) => <div role="listitem" key={c.agentId}><AgentCard c={c} now={now} plan={plan} active={i === cur} tabIndex={i === cur ? 0 : -1} refCb={(el) => { els.current[i] = el; }} onKey={(e) => { if ((e.target as HTMLElement).closest('button')) return; if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); move(i + 1); } else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); move(i - 1); } else if (e.key === 'Enter') { onOpen?.(c.agentId); } }} onOpen={onOpen} onMerge={onMerge} /></div>)}</div>;
}
export function ConflictList({ cards }: { cards: FleetCard[] }): React.JSX.Element | null {
  const c = cards.filter((x) => x.conflict); const l = cards.filter((x) => x.locks > 0); if (!c.length && !l.length) return null;
  return <Card title="Locks and conflicts">{c.length ? <Banner tone="danger" title="! Merge conflict">{c.map((x) => x.label).join(' and ')} changed the same file. Take turns or branch off.</Banner> : null}{l.length ? <ul>{l.map((x) => <li key={x.agentId}>{x.label} holds {x.locks === 1 ? 'a file' : `${x.locks} files`}</li>)}</ul> : null}</Card>;
}
export { MAX_ANIMATED };
