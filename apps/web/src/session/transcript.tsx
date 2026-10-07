import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Banner, Button, Chip } from '../ui/index.js';
import type { TranscriptEntry } from '@centcom/guest';
import { Markdown } from './markdown.js';
import { estimate, windowRange } from './window.js';

export interface TranscriptActions { approve?(approvalId: string): void; deny?(approvalId: string): void }
const RISK_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = { low: 'success', medium: 'warning', high: 'danger', critical: 'danger' };
export function Entry({ e, isHost, actions, focused }: { e: TranscriptEntry; isHost: boolean; actions?: TranscriptActions; focused?: boolean }): React.JSX.Element {
  switch (e.kind) {
    case 'user': return <article className="cc-msg cc-msg--user" aria-label="Message"><Markdown text={e.text} /></article>;
    case 'assistant': return <article className="cc-msg" aria-label="Cento"><Markdown text={e.text} />{e.gap ? <span className="cc-help">Waiting for a missing part…</span> : null}{!e.done ? <span className="cc-help" aria-hidden="true"> …</span> : null}</article>;
    case 'system': return <p className={`cc-msg cc-msg--system cc-msg--${e.level}`}>{e.text}</p>;
    case 'tool_request': return <article className="cc-card cc-tool" aria-label={`Tool: ${e.name}`}><strong>{e.name}</strong> <Chip tone={RISK_TONE[e.risk] ?? 'neutral'}>{e.risk || 'risk unknown'}</Chip><p className="cc-help">{e.summary}</p></article>;
    case 'tool_result': return <article className="cc-card cc-tool" aria-label="Tool result"><Chip tone={e.status === 'ok' || e.status === 'success' ? 'success' : 'danger'}>{e.status}</Chip> <span>{e.summary}</span></article>;
    case 'approval': return <article className="cc-card cc-approval" tabIndex={0} data-approval={e.approvalId} aria-label={`Approval needed: ${e.summary || 'an action'}`} data-focused={focused ? 'true' : undefined}><Chip tone={RISK_TONE[e.risk] ?? 'warning'}>{e.risk || 'approval'}</Chip> <span>{e.summary || 'An agent wants to act.'}</span>{e.decision ? <p role="status">{e.decision === 'allow' || e.decision === 'approve' || e.decision === 'approved' ? 'Approved' : 'Denied'}</p> : isHost ? <div><Button onClick={() => actions?.approve?.(e.approvalId)}>Approve (a)</Button><Button onClick={() => actions?.deny?.(e.approvalId)}>Deny (d)</Button></div> : <p className="cc-help">Waiting for the host.</p>}</article>;
    default: return <p className="cc-help">{e.frameKind}</p>;
  }
}
/** Only the rows near the screen are in the page (at most 200). New text at the bottom keeps you at the bottom unless you scrolled up. */
export function TranscriptView({ entries, isHost = false, actions, height = 480, heights: heightsIn }: { entries: TranscriptEntry[]; isHost?: boolean; actions?: TranscriptActions; height?: number; heights?: number[] }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null); const [top, setTop] = useState(0); const stick = useRef(true); const measured = useRef(new Map<string, number>());
  const hs = useMemo(() => heightsIn ?? entries.map((e) => measured.current.get(`${e.seq}`) ?? estimate(e.kind, 'text' in e ? e.text.length : 0)), [entries, heightsIn]); const r = useMemo(() => windowRange(hs, top, height), [hs, top, height]);
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [entries.length]);
  return <div ref={box} className="cc-transcript" role="log" aria-label="Session transcript" tabIndex={0} data-rows={r.end - r.start} onScroll={(e) => { const el = e.currentTarget; setTop(el.scrollTop); stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40; }}>
    <div data-spacer="top" data-h={r.top} />{entries.slice(r.start, r.end).map((e) => <div key={`${e.seq}`} className="cc-row-entry" data-seq={e.seq}><Entry e={e} isHost={isHost} actions={actions} /></div>)}<div data-spacer="bottom" data-h={r.bottom} /></div>;
}
export const StatusScreens = { 4426: 'Centcom needs an update to keep working. Update and come back.', 4403: 'You were removed from this session.', 4404: 'This session has ended.' } as Record<number, string>;
export function PhaseScreen({ phase, code }: { phase: string; code?: number }): React.JSX.Element | null {
  if (phase === 'waiting_for_key') return <Banner tone="info" title="Waiting for the host to let you in">The host is sending you the key. This takes a moment.</Banner>;
  if (code === 4426) return <Banner tone="danger" title="Update required">{StatusScreens[4426]}</Banner>; if (phase === 'kicked' || code === 4403) return <Banner tone="danger" title="Removed">{StatusScreens[4403]}</Banner>; if (phase === 'ended' || code === 4404) return <Banner tone="info" title="Ended">{StatusScreens[4404]}</Banner>; if (phase === 'reconnecting') return <Banner tone="warning" title="Reconnecting">Trying to get back into the session.</Banner>; return null;
}
