import { FleetModel, type FEvent, type FleetView } from '@centcom/fleet';
import { stateText } from '../i18n/states.js';
import { glyphFor, priorityOf } from './priority.js';

export interface MemberInfo { id: string; name: string; slot: number }
export interface Card { agentId: string; label: string; owner: string; ownerName: string; ownerSlot: number; mine: boolean; state: string; word: string; glyph: string; tier: number; since?: string; branch?: string; ahead?: number; behind?: number; dirty?: boolean; locks: number; conflict: boolean; exited: boolean; unknown: boolean; needsYou: boolean }
export interface FleetOptions { members: () => MemberInfo[]; me: string; log?: (m: string) => void }
/** The board's data: the shared fleet reducer plus the words, ordering and neutral labels around it. */
export class FleetStore {
  private model: FleetModel; private subs = new Set<() => void>(); private n = new Map<string, number>(); private logged = new Set<string>();
  constructor(private readonly o: FleetOptions) { this.model = new FleetModel((id) => o.members().some((m) => m.id === id)); }
  subscribe(f: () => void): () => void { this.subs.add(f); return () => { this.subs.delete(f); }; }
  apply(e: FEvent): void { const notes = this.model.apply(e); if (notes.some((x) => x.type !== 'ignored') || e.kind.startsWith('agent.') || e.kind === 'branch.update' || e.kind === 'file.lock') for (const f of [...this.subs]) f(); }
  view(): FleetView { return this.model.view(); }
  /** One card per agent, the ones that need a person first, then the longest waiting. Labels and branches only exist after their frames were opened; before that the card is "Agent 1". */
  cards(f: { owner?: string; state?: string } = {}): Card[] {
    const v = this.model.view(); const ms = this.o.members(); const out: Card[] = [];
    for (const g of v.members) for (const a of g.agents) { const m = ms.find((x) => x.id === a.owner); if (!this.n.has(a.agentId)) this.n.set(a.agentId, this.n.size + 1);
      const unknown = a.rawState !== undefined; if (unknown && !this.logged.has(a.agentId)) { this.logged.add(a.agentId); this.o.log?.('fleet.unknown_state'); }
      const state = a.exited ? 'idle' : a.state; const word = a.exited ? (a.exited.outcome === 'ok' ? 'Done' : 'Stopped') : unknown ? 'Working' : stateText(state, { count: 1 });
      out.push({ agentId: a.agentId, label: a.label ?? `Agent ${this.n.get(a.agentId)}`, owner: a.owner, ownerName: m?.name ?? 'Someone', ownerSlot: m?.slot ?? 0, mine: a.owner === this.o.me, state, word, glyph: glyphFor(state, !!a.exited), tier: priorityOf(state), ...(a.since ? { since: a.since } : {}), ...(a.branchStatus ? { branch: a.branchStatus.branch, ahead: a.branchStatus.ahead, behind: a.branchStatus.behind, dirty: a.branchStatus.dirty } : a.branch ? { branch: a.branch } : {}), locks: v.locks.filter((l) => l.agentId === a.agentId).length, conflict: v.conflicts.some((c) => c.agentIds.includes(a.agentId)), exited: !!a.exited, unknown, needsYou: a.owner === this.o.me && priorityOf(state) <= 2 });
    }
    return sortCards(out).filter((c) => (!f.owner || c.owner === f.owner) && (!f.state || c.state === f.state));
  }
}
/** Needs a person first (tier), then mine before others', then the one waiting longest. */
export function sortCards(cards: Card[]): Card[] { return [...cards].sort((a, b) => a.tier - b.tier || Number(b.needsYou) - Number(a.needsYou) || Date.parse(a.since ?? '') - Date.parse(b.since ?? '') || a.agentId.localeCompare(b.agentId)); }
/** At most six mascots move; the rest hold their first frame. The running card is the only one with the glow. */
export const MAX_ANIMATED = 6;
export function motionPlan(cards: Card[], reduced: boolean): { animated: Set<string>; glow?: string } { const animated = new Set<string>(); if (!reduced) for (const c of cards) { if (animated.size >= MAX_ANIMATED) break; if (!c.exited) animated.add(c.agentId); } const run = cards.find((c) => c.tier === 4 && !c.exited); return { animated, ...(run ? { glow: run.agentId } : {}) }; }
export const middleTruncate = (s: string, max = 24): string => (s.length <= max ? s : `${s.slice(0, Math.ceil((max - 1) / 2))}…${s.slice(s.length - Math.floor((max - 1) / 2))}`);
export const elapsed = (since: string | undefined, now: number): string => { const t = Date.parse(since ?? ''); if (!Number.isFinite(t)) return ''; const s = Math.max(0, Math.floor((now - t) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`; };
