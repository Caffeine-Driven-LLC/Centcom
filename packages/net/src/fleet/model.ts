/** Everyone's agents, branches, locks and conflicts as the session's frames say. A pure reducer: the same frames in the same order give the same view, and a repeated frame changes nothing. */
import { AGENT_WIRE_STATES } from '@centcom/protocol';
export const GENERIC_WORKING_STATE = 'thinking';
const KNOWN = new Set<string>(AGENT_WIRE_STATES);
export interface AgentView { agentId: string; owner: string; mode: 'command_post' | 'branch'; state: string; /** the state exactly as the sender named it when we do not know it */ rawState?: string; since?: string; label?: string; branch?: string; worktree?: string; model?: string; runsOn?: string; provider?: string; branchStatus?: { branch: string; head: string; ahead: number; behind: number; dirty: boolean }; exited?: { outcome: string; errorCode?: string; detail?: string } }
export interface LockView { pathHmac: string; agentId: string; member: string; /** milliseconds since the epoch when it ends, from the frame's own time and ttl */ expiresAt?: number; path?: string }
export interface ConflictView { agentIds: string[]; pathHmacs: string[]; paths?: string[]; at: string }
export interface FleetView { members: { memberId: string; agents: AgentView[] }[]; locks: LockView[]; conflicts: ConflictView[] }
export interface FEvent { kind: string; seq: number; from: string; ts: string; p?: Record<string, unknown>; secret?: Record<string, unknown> }
export type Note = { type: 'conflict'; conflict: ConflictView } | { type: 'lock-denied'; pathHmac: string; agentId: string } | { type: 'lock-expired'; lock: LockView } | { type: 'agent'; agentId: string } | { type: 'ignored'; reason: string };
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export class FleetModel {
  private agents = new Map<string, AgentView>(); private locks = new Map<string, LockView>(); private conflicts: ConflictView[] = []; private lastSeq = 0; private seenConflicts = new Set<string>();
  constructor(private readonly isMember: (id: string) => boolean) {}
  view(): FleetView {
    const by = new Map<string, AgentView[]>(); for (const a of this.agents.values()) { const l = by.get(a.owner) ?? []; l.push({ ...a }); by.set(a.owner, l); }
    return { members: [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([memberId, agents]) => ({ memberId, agents: agents.sort((a, b) => a.agentId.localeCompare(b.agentId)) })), locks: [...this.locks.values()].sort((a, b) => a.pathHmac.localeCompare(b.pathHmac)).map((l) => ({ ...l })), conflicts: this.conflicts.map((c) => ({ ...c })) };
  }
  agent(id: string): AgentView | undefined { return this.agents.get(id); }
  apply(e: FEvent): Note[] {
    if (e.seq > 0 && e.seq <= this.lastSeq) return [{ type: 'ignored', reason: 'old_seq' }]; if (e.seq > 0) this.lastSeq = e.seq;
    const p = e.p ?? {}; const server = e.from === 'srv';
    if (!server && !this.isMember(e.from)) return [{ type: 'ignored', reason: 'not_member' }];
    switch (e.kind) {
      case 'agent.spawn': { const id = str(p.agent_id); if (!id) return [{ type: 'ignored', reason: 'malformed' }]; const old = this.agents.get(id); if (old && old.owner !== e.from) return [{ type: 'ignored', reason: 'not_owner' }]; /* the sender is the owner, whatever `owner` says */
        this.agents.set(id, { ...old, agentId: id, owner: e.from, mode: p.mode === 'branch' ? 'branch' : 'command_post', state: old?.state ?? 'idle', ...(str(p.runs_on) ? { runsOn: str(p.runs_on) } : {}), ...(str(p.provider) ? { provider: str(p.provider) } : {}), ...(str(e.secret?.label) ? { label: str(e.secret!.label) } : {}), ...(str(e.secret?.branch) ? { branch: str(e.secret!.branch) } : {}), ...(str(e.secret?.worktree) ? { worktree: str(e.secret!.worktree) } : {}), ...(str(e.secret?.model) ? { model: str(e.secret!.model) } : {}) }); return [{ type: 'agent', agentId: id }]; }
      case 'agent.state': { const a = this.own(e, p); if (!a) return [{ type: 'ignored', reason: 'unknown_agent' }]; const s = str(p.state); if (!s) return [{ type: 'ignored', reason: 'malformed' }]; if (KNOWN.has(s)) { a.state = s; delete a.rawState; } else { a.state = GENERIC_WORKING_STATE; a.rawState = s.slice(0, 40); } if (str(p.since)) a.since = str(p.since); return [{ type: 'agent', agentId: a.agentId }]; }
      case 'agent.exit': { const a = this.own(e, p); if (!a) return [{ type: 'ignored', reason: 'unknown_agent' }]; a.exited = { outcome: String(p.outcome ?? 'error'), ...(str(p.error_code) ? { errorCode: str(p.error_code) } : {}), ...(str(e.secret?.detail) ? { detail: str(e.secret!.detail) } : {}) }; return [{ type: 'agent', agentId: a.agentId }]; }
      case 'branch.update': { const id = str(e.secret?.agent_id); const a = id ? this.agents.get(id) : undefined; if (!a || a.owner !== e.from) return [{ type: 'ignored', reason: 'unknown_agent' }]; const s = e.secret!; a.branchStatus = { branch: String(s.branch ?? ''), head: String(s.head ?? ''), ahead: Number(s.ahead ?? 0), behind: Number(s.behind ?? 0), dirty: s.dirty === true }; a.branch = a.branchStatus.branch; return [{ type: 'agent', agentId: a.agentId }]; }
      case 'file.lock': return this.lock(e, p, server);
      case 'conflict.detected': { const ids = Array.isArray(p.agent_ids) ? p.agent_ids.filter((x): x is string => typeof x === 'string') : []; const hm = Array.isArray(p.path_hmacs) ? p.path_hmacs.filter((x): x is string => typeof x === 'string') : []; if (!ids.length) return [{ type: 'ignored', reason: 'malformed' }]; const key = `${[...ids].sort().join(',')}|${[...hm].sort().join(',')}`; if (this.seenConflicts.has(key)) return [{ type: 'ignored', reason: 'duplicate' }]; this.seenConflicts.add(key);
        const c: ConflictView = { agentIds: ids, pathHmacs: hm, ...(Array.isArray(e.secret?.paths) ? { paths: (e.secret!.paths as unknown[]).filter((x): x is string => typeof x === 'string') } : {}), at: e.ts }; this.conflicts.push(c); return [{ type: 'conflict', conflict: c }]; }
      default: return [];
    }
  }
  private own(e: FEvent, p: Record<string, unknown>): AgentView | undefined { const a = this.agents.get(String(p.agent_id)); return a && a.owner === e.from ? a : undefined; }
  private lock(e: FEvent, p: Record<string, unknown>, server: boolean): Note[] {
    const hmac = str(p.path_hmac); const agent = str(p.agent_id); if (!hmac || !agent) return [{ type: 'ignored', reason: 'malformed' }];
    switch (p.action) {
      case 'acquire': { if (server) return [{ type: 'ignored', reason: 'forged' }]; const cur = this.locks.get(hmac); if (cur && cur.agentId !== agent && (cur.expiresAt === undefined || cur.expiresAt > Date.parse(e.ts))) return [{ type: 'ignored', reason: 'held' }]; const ttl = typeof p.ttl_ms === 'number' && p.ttl_ms > 0 ? p.ttl_ms : undefined; this.locks.set(hmac, { pathHmac: hmac, agentId: agent, member: e.from, ...(ttl !== undefined && Number.isFinite(Date.parse(e.ts)) ? { expiresAt: Date.parse(e.ts) + ttl } : {}), ...(str(e.secret?.path) ? { path: str(e.secret!.path) } : {}) }); return []; }
      case 'release': { const cur = this.locks.get(hmac); if (cur && cur.agentId === agent && cur.member === e.from) this.locks.delete(hmac); return []; }
      case 'expire': { if (!server) return [{ type: 'ignored', reason: 'forged' }]; const cur = this.locks.get(hmac); if (cur) { this.locks.delete(hmac); return [{ type: 'lock-expired', lock: cur }]; } return []; }
      case 'deny': { if (!server) return [{ type: 'ignored', reason: 'forged' }]; return [{ type: 'lock-denied', pathHmac: hmac, agentId: agent }]; }
      default: return [{ type: 'ignored', reason: 'unknown_action' }]; /* a future action */
    }
  }
}
