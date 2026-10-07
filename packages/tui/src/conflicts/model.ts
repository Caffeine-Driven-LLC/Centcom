/** Who holds which file, who is waiting, and which agents conflict (lane C078). Locks are advisory: nothing here stops anyone from editing. A path is only ever the decrypted `ct.path` of a frame; otherwise the label is a short prefix of `path_hmac`. */
import { priorityOf } from '../mascot/priority.js';

export type MemberId = string; export type AgentId = string;
export interface LockView { pathHmac: string; displayPath?: string; holder: MemberId; agent: AgentId; expiresAt?: number; waiting: AgentId[] }
export interface ConflictView { id: string; agents: AgentId[]; pathHmacs: string[]; displayPaths?: string[]; at: string; seq: number }
/** A decoded frame as this module needs it: `secret` is the decrypted payload, absent when the key is not here yet. */
export interface ConflictEvent { kind: string; seq: number; from: string; ts: string; p?: Record<string, unknown>; secret?: Record<string, unknown> | null }
export interface ConflictSnapshot { locks: LockView[]; conflicts: ConflictView[] }
export interface ConflictSource { subscribe(fn: () => void): () => void; getSnapshot(): ConflictSnapshot }
export interface StoreLogger { debug(msg: string, fields?: Record<string, unknown>): void }
export const MAX_LOG_PER_PATH = 200; export const MAX_CONFLICTS = 50;

const str = (v: unknown): string => (typeof v === 'string' ? v : ''); const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
/** The label of a file: its decrypted path, else `file ab12…`; never empty. */
export function fileLabel(pathHmac: string, displayPath?: string): string { if (displayPath && displayPath.trim()) return displayPath; const h = pathHmac.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 4); return h ? `file ${h}…` : 'a file'; }

interface LockEv { seq: number; action: 'acquire' | 'deny' | 'release' | 'expire'; agent: AgentId; from: MemberId; at: number; ttlMs?: number }
export class ConflictStore implements ConflictSource {
  private log = new Map<string, LockEv[]>(); private labels = new Map<string, string>(); private conflicts_ = new Map<string, ConflictView>(); private agentState = new Map<AgentId, { seq: number; state: string }>();
  private fns = new Set<() => void>(); private snap: ConflictSnapshot = { locks: [], conflicts: [] }; private dirty = true; private seen = new Set<string>();
  constructor(private readonly o: { logger?: StoreLogger; now?: () => number } = {}) {}
  subscribe(fn: () => void): () => void { this.fns.add(fn); return () => { this.fns.delete(fn); }; }
  getSnapshot(): ConflictSnapshot { if (this.dirty) { this.snap = this.compute(); this.dirty = false; } return this.snap; }
  private changed(): void { this.dirty = true; for (const f of [...this.fns]) { try { f(); } catch { /* a listener must not break the store */ } } }

  /** Folds one frame. Duplicates and late frames are harmless: each path keeps its events ordered by seq and the state is recomputed from them. */
  apply(e: ConflictEvent): void {
    try {
      if (e.kind === 'file.lock') return this.applyLock(e); if (e.kind === 'conflict.detected') return this.applyConflict(e);
      if (e.kind === 'agent.state' && typeof e.p?.agent_id === 'string') { const id = e.p.agent_id; const cur = this.agentState.get(id); if (!cur || e.seq > cur.seq) { this.agentState.set(id, { seq: e.seq, state: str(e.p.state) }); this.resolveQuiet(id); this.changed(); } return; }
      if (e.kind === 'agent.exit' && typeof e.p?.agent_id === 'string') { this.agentState.set(e.p.agent_id, { seq: e.seq, state: 'exited' }); this.resolveQuiet(e.p.agent_id); this.changed(); }
    } catch { this.o.logger?.debug('conflicts.bad_frame', { kind: e.kind, seq: e.seq }); }
  }
  private applyLock(e: ConflictEvent): void {
    const p = e.p ?? {}; const hmac = str(p.path_hmac); const action = str(p.action) as LockEv['action']; const agent = str(p.agent_id); if (!hmac || !agent || !['acquire', 'deny', 'release', 'expire'].includes(action)) return;
    const k = `${hmac}:${e.seq}`; if (this.seen.has(k)) return; this.seen.add(k); if (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value as string);
    const path = str(e.secret?.path); if (path) this.labels.set(hmac, path); /* a label from a later frame upgrades the hmac one */
    const at = Date.parse(e.ts); const ev: LockEv = { seq: e.seq, action, agent, from: e.from, at: Number.isFinite(at) ? at : (this.o.now?.() ?? Date.now()), ...(typeof p.ttl_ms === 'number' && p.ttl_ms > 0 ? { ttlMs: p.ttl_ms } : {}) };
    const list = this.log.get(hmac) ?? []; list.push(ev); list.sort((a, b) => a.seq - b.seq); if (list.length > MAX_LOG_PER_PATH) list.splice(0, list.length - MAX_LOG_PER_PATH); this.log.set(hmac, list);
    this.o.logger?.debug('conflicts.lock', { action, seq: e.seq, file: hmac.slice(0, 4) }); this.changed();
  }
  private applyConflict(e: ConflictEvent): void {
    const agents = strs(e.p?.agent_ids); if (!agents.length) return; const hm = strs(e.p?.path_hmacs); const id = `${[...agents].sort().join('+')}|${[...hm].sort().join('+')}`; const paths = strs(e.secret?.paths);
    const cur = this.conflicts_.get(id); if (cur && cur.seq >= e.seq) return; this.conflicts_.set(id, { id, agents, pathHmacs: hm, ...(paths.length ? { displayPaths: paths } : cur?.displayPaths ? { displayPaths: cur.displayPaths } : {}), at: e.ts, seq: e.seq });
    paths.forEach((p, i) => { if (hm[i]) this.labels.set(hm[i]!, p); }); this.resolveQuiet(''); if (this.conflicts_.size > MAX_CONFLICTS) this.conflicts_.delete(this.conflicts_.keys().next().value as string); this.o.logger?.debug('conflicts.detected', { seq: e.seq, agents: agents.length }); this.changed();
  }
  /** A conflict ends when every agent in it has said something newer than the conflict that is not `merge-conflict`. */
  private resolveQuiet(_agent: AgentId): void { for (const [id, c] of this.conflicts_) if (c.agents.every((a) => { const s = this.agentState.get(a); return !!s && s.seq > c.seq && s.state !== 'merge-conflict'; })) this.conflicts_.delete(id); }
  /** The caller resolved it (the action finished): the banner goes. */
  markResolved(id: string): void { if (this.conflicts_.delete(id)) this.changed(); }

  private compute(): ConflictSnapshot {
    const locks: LockView[] = [];
    for (const [hmac, list] of this.log) {
      let holder: LockEv | undefined; let waiting: AgentId[] = [];
      for (const ev of list) {
        if (ev.action === 'acquire') { if (!holder || holder.agent === ev.agent) { holder = ev; waiting = waiting.filter((a) => a !== ev.agent); } }
        else if (ev.action === 'deny') { if (holder && holder.agent !== ev.agent && !waiting.includes(ev.agent)) waiting.push(ev.agent); else if (!holder && !waiting.includes(ev.agent)) waiting.push(ev.agent); }
        else if (!holder || holder.agent === ev.agent || ev.action === 'expire') { holder = undefined; waiting = []; }
      }
      if (!holder) continue; const expiresAt = holder.ttlMs !== undefined ? holder.at + holder.ttlMs : undefined;
      locks.push({ pathHmac: hmac, ...(this.labels.get(hmac) ? { displayPath: this.labels.get(hmac) } : {}), holder: holder.from, agent: holder.agent, ...(expiresAt !== undefined ? { expiresAt } : {}), waiting });
    }
    return { locks, conflicts: [...this.conflicts_.values()].map((c) => ({ ...c, displayPaths: c.pathHmacs.map((h, i) => c.displayPaths?.[i] ?? this.labels.get(h) ?? '') .map((p, i) => p || fileLabel(c.pathHmacs[i] ?? '')) })) };
  }
}

/** How an agent's card should look: its real state, or `merge-conflict`; plus the animation for the lock (DESIGN.md 11.2: a conflict outranks tool work but never an approval or a first-tier error). */
export function cardState(agent: AgentId, real: string, s: ConflictSnapshot): { state: string; animation?: 'waiting' | 'file_locked' } {
  const inConflict = s.conflicts.some((c) => c.agents.includes(agent)); const tier = priorityOf(real); const urgent = real === 'awaiting-approval' || real === 'asking-question' || tier === 1;
  const holds = s.locks.some((l) => l.agent === agent); const waits = s.locks.some((l) => l.waiting.includes(agent));
  const state = inConflict && !urgent ? 'merge-conflict' : real; const animation = urgent || state === 'merge-conflict' ? undefined : waits ? 'waiting' : holds ? 'file_locked' : undefined;
  return { state, ...(animation ? { animation } : {}) };
}
/** Whole seconds left, never negative; `undefined` when the lock came without a ttl (shown as `held`). */
export const secondsLeft = (expiresAt: number | undefined, now: number): number | undefined => (expiresAt === undefined ? undefined : Math.max(0, Math.ceil((expiresAt - now) / 1000)));
