/** Pair mode: two members on one agent share one selection (lane C079). Entering and leaving is an agreement carried by `agent.state` and `presence.cursor` frames. */
import type { AgentId, HandoffSession, MemberId, Observable, Selection, Unsubscribe } from './types.js';

export const PAIR_STATE = 'pair-working';
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const before = (l1: number, c1: number, l2: number, c2: number): boolean => l1 < l2 || (l1 === l2 && c1 <= c2);
/** The union of two selections on the same file; `undefined` when they are on different files. */
export function mergeSelections(a: Selection, b: Selection): Selection | undefined {
  if ((a.path ?? '') !== (b.path ?? '')) return undefined;
  const norm = (s: Selection) => (before(s.line, s.col, s.selEndLine, s.selEndCol) ? { sl: s.line, sc: s.col, el: s.selEndLine, ec: s.selEndCol } : { sl: s.selEndLine, sc: s.selEndCol, el: s.line, ec: s.col });
  const x = norm(a); const y = norm(b); const start = before(x.sl, x.sc, y.sl, y.sc) ? x : y; const end = before(x.el, x.ec, y.el, y.ec) ? y : x;
  return { ...(a.path !== undefined ? { path: a.path } : {}), line: start.sl, col: start.sc, selEndLine: end.el, selEndCol: end.ec };
}
const toSelection = (c: Record<string, unknown> | undefined): Selection | undefined => { if (!c) return undefined; const line = num(c.line); if (line === undefined) return undefined; const col = num(c.col) ?? 0; return { ...(typeof c.path === 'string' ? { path: c.path } : {}), line, col, selEndLine: num(c.sel_end_line) ?? line, selEndCol: num(c.sel_end_col) ?? col }; };

export interface PairHandle { stop(): void; readonly sharedSelection$: Observable<Selection | null>; readonly active: boolean; /** call with your own cursor whenever it moves */ setLocal(sel: Selection | null): void }
export interface PairOptions { /** publishes (or, with `null`, clears) your own cursor as an independent one */ publishCursor?: (sel: Selection | null) => void }
export function startPair(session: HandoffSession, agent: AgentId, partner: MemberId, opts: PairOptions = {}): PairHandle {
  let mine: Selection | undefined; let theirs: Selection | undefined; let active = true; const subs = new Set<(v: Selection | null) => void>(); let last: Selection | null = null; let theirsWorking = false;
  const emit = (): void => { const v = active && mine && theirs ? mergeSelections(mine, theirs) ?? null : null; if (JSON.stringify(v) === JSON.stringify(last)) return; last = v; for (const f of [...subs]) { try { f(v); } catch { /* a listener must not break pairing */ } } };
  const off: Unsubscribe = session.onFrame((f) => {
    if (!active) return;
    if (f.kind === 'presence.cursor' && f.from === partner) { theirs = toSelection(f.secret); emit(); }
    else if (f.kind === 'agent.state' && f.p?.agent_id === agent && f.from === partner) { theirsWorking = f.p.state === PAIR_STATE; if (!theirsWorking) { theirs = undefined; emit(); } }
    else if (f.kind === 'control.member_left' && f.p?.member === partner) { theirs = undefined; theirsWorking = false; emit(); }
  });
  void session.send('agent.state', { p: { agent_id: agent, state: PAIR_STATE, since: new Date(session.clock.now()).toISOString() } }).catch(() => undefined); /* best effort: pairing works without the roster hint */
  return {
    get active() { return active; }, sharedSelection$: { subscribe: (fn) => { subs.add(fn); fn(last); return () => { subs.delete(fn); }; } },
    setLocal(sel) { mine = sel ?? undefined; emit(); },
    stop() { if (!active) return; active = false; emit(); off(); void session.send('agent.state', { p: { agent_id: agent, state: 'idle', since: new Date(session.clock.now()).toISOString() } }).catch(() => undefined); opts.publishCursor?.(mine ?? null); },
  };
}
