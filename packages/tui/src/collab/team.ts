/**
 * The team view of a shared session in branch mode: every member, each of their agents (provider, state, branch, how far ahead or behind,
 * the files it has locked, what it last said), the conflicts between agents and the offers of work. It is built only from what the session
 * says (`agent.*`, `branch.update`, `file.lock`, `conflict.detected`, `approval.*`, `message.*`) and the roster, and it ignores a frame that
 * names an agent its sender does not own: a member can only speak for their own agents (the host for any).
 *
 * Nothing here is sent. Paths are the decrypted `secret.path` of a frame; without the key a lock shows as `a file`.
 */
import type { DecodedEvent, MemberInfo } from '@centcom/net';

export type Provider = 'anthropic' | 'openai' | 'other';
export interface TeamLock { hmac: string; path?: string; until: number }
export interface TeamAgent {
  id: string; owner: string; mode: 'command_post' | 'branch'; provider?: Provider; label?: string; model?: string; branch?: string;
  state: string; since: string; exit?: { outcome: string }; head?: string; ahead?: number; behind?: number; dirty?: boolean;
  locks: TeamLock[]; waiting?: { approval: string; risk: string }; lastSaid?: string; sharing: boolean;
}
export interface TeamMember { id: string; name: string; role: string; slot: number; online: boolean; you: boolean; agents: TeamAgent[] }
export interface TeamConflict { id: string; agents: string[]; hmacs: string[]; paths: string[]; at: string }
export interface TeamHandoff { id: string; from: string; to: string; agent: string; note?: string; state: 'offered' | 'accepted' | 'declined'; at: string }
/** One line of a teammate's transcript, as they chose to share it (the activity switch). Text is cleaned of terminal control codes. */
export interface TeamLine { id: string; kind: 'user' | 'assistant' | 'tool' | 'system'; text: string; ts: string; /** tools: running, ok, error, denied, canceled */ status?: string; name?: string; level?: string; done?: boolean }
export interface TeamView { members: TeamMember[]; conflicts: TeamConflict[]; handoffs: TeamHandoff[]; hints: string[] }

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const SAID_MAX = 160; const LINES_MAX = 300; const LINE_CHARS = 6000;
/** Text from another computer reaches a terminal and an agent-free screen: escape sequences and control codes are removed (new lines and tabs are kept). */
const ESC_SEQ = new RegExp('\\u001b\\[[0-9;?]*[ -\\/]*[@-~]|\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)?|\\u001b[@-Z\\\\-_]', 'g');
const CTRL_KEEP_NL = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069]', 'g');
export const safeText = (s: string, max = LINE_CHARS): string => { const t = s.replace(ESC_SEQ, '').replace(CTRL_KEEP_NL, ' '); return t.length > max ? t.slice(0, max - 1) + '…' : t; };
const clip = (s: string): string => { const t = safeText(s, 4000).replace(/\s+/g, ' ').trim(); return t.length > SAID_MAX ? t.slice(0, SAID_MAX - 1) + '…' : t; };
const DEFAULT_LOCK_MS = 300_000;

export class TeamModel {
  private agents = new Map<string, TeamAgent>(); private roster: MemberInfo[] = []; private me = ''; private conflicts_ = new Map<string, TeamConflict>(); private handoffs_ = new Map<string, TeamHandoff>();
  private said = new Map<string, string>(); private lines_ = new Map<string, TeamLine[]>(); private fns = new Set<() => void>(); private dirty = true; private snap: TeamView = { members: [], conflicts: [], handoffs: [], hints: [] };
  constructor(private readonly o: { now?: () => number } = {}) {}
  private now = (): number => (this.o.now ?? Date.now)();

  subscribe(fn: () => void): () => void { this.fns.add(fn); return () => { this.fns.delete(fn); }; }
  private changed(): void { this.dirty = true; for (const f of [...this.fns]) { try { f(); } catch { /* a listener must not break the model */ } } }
  setRoster(list: readonly MemberInfo[], me: string): void { this.roster = [...list]; this.me = me; this.changed(); }
  private role(member: string): string { return this.roster.find((m) => m.id === member)?.role ?? ''; }
  private mayAct(from: string, agent: TeamAgent): boolean { return from === agent.owner || this.role(from) === 'host'; }

  apply(e: DecodedEvent): void {
    try {
      switch (e.kind) {
        case 'agent.spawn': return this.spawn(e);
        case 'agent.state': return this.update(e, (a) => { a.state = str(e.p?.['state']) || a.state; a.since = str(e.p?.['since']) || a.since; if (a.state !== 'awaiting-approval') delete a.waiting; });
        case 'agent.exit': return this.update(e, (a) => { a.exit = { outcome: str(e.p?.['outcome']) || 'ok' }; a.state = 'exited'; a.locks = []; delete a.waiting; });
        case 'branch.update': return this.branch(e);
        case 'file.lock': return this.lock(e);
        case 'conflict.detected': return this.conflict(e);
        case 'agent.handoff': return this.handoff(e);
        case 'approval.request': return this.update(e, (a) => { a.waiting = { approval: str(e.p?.['approval_id']), risk: str(e.p?.['risk']) || 'medium' }; });
        case 'approval.decision': { const id = str(e.p?.['approval_id']); for (const a of this.agents.values()) if (a.waiting?.approval === id && this.mayAct(e.from, a)) { delete a.waiting; this.changed(); } return; }
        case 'message.user': this.addLine(e, 'user'); return this.message(e, str(e.secret?.['text']), true);
        case 'tool.request': case 'tool.result': case 'message.system': this.addLine(e, e.kind === 'message.system' ? 'system' : 'tool'); return;
        case 'message.assistant.delta': this.addLine(e, 'assistant'); return this.message(e, str(e.secret?.['delta']), false);
        case 'message.assistant.done': { this.addLine(e, 'assistant', true); const a = this.agents.get(str(e.secret?.['agent_id'])); if (a && this.mayAct(e.from, a)) this.said.delete(str(e.secret?.['message_id'])); return; }
        default: return;
      }
    } catch { /* a malformed frame is ignored */ }
  }
  private spawn(e: DecodedEvent): void {
    const id = str(e.p?.['agent_id']); const owner = str(e.p?.['owner']); if (!id || !owner) return; if (e.from !== owner && this.role(e.from) !== 'host') return;
    const old = this.agents.get(id); if (old && old.owner !== owner) return;
    const provider = str(e.p?.['provider']); const mode = e.p?.['mode'] === 'branch' ? 'branch' : 'command_post';
    const a: TeamAgent = { ...(old ?? { id, owner, state: 'idle', since: e.ts, locks: [], sharing: false }), id, owner, mode, ...(provider === 'anthropic' || provider === 'openai' || provider === 'other' ? { provider } : {}) };
    const s = e.secret; if (s) { if (str(s['label'])) a.label = safeText(str(s['label']), 80); if (str(s['model'])) a.model = safeText(str(s['model']), 80); if (str(s['branch'])) a.branch = safeText(str(s['branch']), 200); }
    this.agents.set(id, a); this.changed();
  }
  /** The agent a frame is about. One whose `agent.spawn` was missed (this person joined later) is entered when its own sender speaks for it, with what is not known left out: the spawn only says provider and label. */
  private agentFor(id: string, from: string, ts: string, mode: 'command_post' | 'branch' = 'branch'): TeamAgent | undefined {
    if (!id) return undefined; const a = this.agents.get(id); if (a) return a; if (!this.roster.some((m) => m.id === from)) return undefined;
    const n: TeamAgent = { id, owner: from, mode, state: 'idle', since: ts, locks: [], sharing: false }; this.agents.set(id, n); return n;
  }
  private update(e: DecodedEvent, fn: (a: TeamAgent) => void): void { const a = this.agentFor(str(e.p?.['agent_id']), e.from, e.ts); if (!a || !this.mayAct(e.from, a)) return; fn(a); this.changed(); }
  private branch(e: DecodedEvent): void {
    const s = e.secret; const a = s ? this.agentFor(str(s['agent_id']), e.from, e.ts) : undefined; if (!a || !s || !this.mayAct(e.from, a)) return;
    a.branch = safeText(str(s['branch']), 200) || a.branch; a.head = safeText(str(s['head']), 64) || a.head; const ah = num(s['ahead']); const be = num(s['behind']); if (ah !== undefined) a.ahead = ah; if (be !== undefined) a.behind = be; if (typeof s['dirty'] === 'boolean') a.dirty = s['dirty']; this.changed();
  }
  private lock(e: DecodedEvent): void {
    const a = this.agentFor(str(e.p?.['agent_id']), e.from, e.ts); const hmac = str(e.p?.['path_hmac']); if (!a || !hmac || !this.mayAct(e.from, a)) return; const action = str(e.p?.['action']);
    a.locks = a.locks.filter((l) => l.hmac !== hmac);
    // the receiver's clock from receipt: a sender's timestamp is never used (replayed history converges because releases replay too)
    if (action === 'acquire') { const ttl = num(e.p?.['ttl_ms']) ?? DEFAULT_LOCK_MS; const path = safeText(str(e.secret?.['path']), 400); a.locks.push({ hmac, ...(path ? { path } : {}), until: this.now() + ttl }); }
    this.changed();
  }
  private conflict(e: DecodedEvent): void {
    const agents = Array.isArray(e.p?.['agent_ids']) ? (e.p!['agent_ids'] as unknown[]).map(str).filter(Boolean) : []; const hmacs = Array.isArray(e.p?.['path_hmacs']) ? (e.p!['path_hmacs'] as unknown[]).map(str).filter(Boolean) : [];
    if (agents.length < 2 || !hmacs.length) return;
    /* like every other frame here, a conflict is the word of someone who owns one of the agents it names (the host, or this person's own runtime): otherwise a member could put text into another person's agent through the digest */
    if (e.from !== this.me && this.role(e.from) !== 'host' && !agents.some((id) => this.agents.get(id)?.owner === e.from)) return; const id = [...agents].sort().join('+') + '|' + [...hmacs].sort().join('+'); const paths = Array.isArray(e.secret?.['paths']) ? (e.secret!['paths'] as unknown[]).slice(0, 20).map((x) => safeText(str(x), 400)).filter(Boolean) : [];
    this.conflicts_.set(id, { id, agents, hmacs, paths, at: e.ts }); if (this.conflicts_.size > 50) this.conflicts_.delete(this.conflicts_.keys().next().value as string); this.changed();
  }
  private handoff(e: DecodedEvent): void {
    const id = str(e.p?.['handoff']); const op = str(e.p?.['op']); const to = str(e.p?.['to']); const agent = str(e.p?.['agent_id']); if (!id) return; const old = this.handoffs_.get(id);
    if (op === 'offer') { const a = this.agents.get(agent); if (a && !this.mayAct(e.from, a)) return; if (old) return; this.handoffs_.set(id, { id, from: e.from, to, agent, ...(str(e.secret?.['note']) ? { note: clip(str(e.secret!['note'])) } : {}), state: 'offered', at: e.ts }); this.changed(); return; }
    if (!old || e.from !== old.to) return; if (op === 'accept' || op === 'decline') { old.state = op === 'accept' ? 'accepted' : 'declined'; this.changed(); }
  }
  private message(e: DecodedEvent, text: string, user: boolean): void {
    const a = this.agents.get(str(e.secret?.['agent_id'])); if (!a || !this.mayAct(e.from, a) || !text) return; a.sharing = true;
    if (user) { a.lastSaid = `${this.nameOf(a.owner)}: ${clip(text)}`; this.changed(); return; }
    const mid = str(e.secret?.['message_id']); const cur = (this.said.get(mid) ?? '') + text; this.said.set(mid, cur.slice(-2000)); a.lastSaid = clip(cur.slice(-SAID_MAX * 3)); this.changed();
  }
  /** Keeps what a member's agent said and did, for the read-only view of their transcript. Only the agent's owner (or the host) can add to it. */
  private addLine(e: DecodedEvent, kind: TeamLine['kind'], done = false): void {
    const s = e.secret ?? {}; const agent = str(s['agent_id']) || str(e.p?.['agent_id']);
    const a = agent ? this.agents.get(agent) : [...this.agents.values()].find((x) => x.owner === e.from && !x.exit); if (!a || !this.mayAct(e.from, a)) return;
    const list = this.lines_.get(a.id) ?? []; this.lines_.set(a.id, list); const push = (l: TeamLine): void => { list.push(l); if (list.length > LINES_MAX) list.splice(0, list.length - LINES_MAX); };
    if (kind === 'user') { const text = safeText(str(s['text'])); if (text) push({ id: e.id, kind, text, ts: e.ts }); }
    else if (kind === 'assistant') {
      const mid = str(s['message_id']); if (!mid) return; let l = list.find((x) => x.id === mid);
      if (done) { if (l) l.done = true; this.changed(); return; }
      const d = str(s['delta']); if (!d) return; if (!l) { l = { id: mid, kind, text: '', ts: e.ts }; push(l); } l.text = safeText(l.text + d);
    } else if (kind === 'tool') {
      const tid = str(s['tool_id']); if (!tid) return; const id = `tool:${tid}`; let l = list.find((x) => x.id === id);
      if (e.kind === 'tool.request') { if (!l) push({ id, kind, text: safeText(str(s['input_summary']), 400), ts: e.ts, status: 'running', name: safeText(str(s['name']), 60) }); }
      else { if (!l) { l = { id, kind, text: '', ts: e.ts, name: 'tool' }; push(l); } l.status = str(s['status']) || 'ok'; const sum = safeText(str(s['summary']), 400); if (sum) l.text = l.text ? `${l.text} → ${sum}` : sum; }
    } else { const text = safeText(str(s['text']), 2000); if (text) push({ id: e.id, kind, text, ts: e.ts, level: str(s['level']) || 'info' }); }
    this.changed();
  }
  /** What a member's agent said and did, oldest first, as far as its owner shares it (empty when nothing is shared). */
  transcript(agent: string): TeamLine[] { return (this.lines_.get(agent) ?? []).map((l) => ({ ...l })); }
  private nameOf(member: string): string { return this.roster.find((m) => m.id === member)?.name || 'Someone'; }

  /** The members, each with their agents; locks past their time are not shown. */
  snapshot(): TeamView {
    if (!this.dirty) return this.snap; const now = this.now(); const byOwner = new Map<string, TeamAgent[]>();
    for (const a of this.agents.values()) { const list = byOwner.get(a.owner) ?? []; list.push({ ...a, locks: a.locks.filter((l) => l.until > now) }); byOwner.set(a.owner, list); }
    const members: TeamMember[] = this.roster.map((m) => ({ id: m.id, name: m.name || 'Someone', role: m.role, slot: m.slot, online: m.online !== false, you: m.id === this.me, agents: byOwner.get(m.id) ?? [] }));
    for (const [owner, agents] of byOwner) if (!members.some((m) => m.id === owner)) members.push({ id: owner, name: 'Someone', role: 'editor', slot: 99, online: false, you: false, agents });
    const hints: string[] = [];
    for (const m of members) for (const a of m.agents) { if (!a.exit && (a.behind ?? 0) >= 10) hints.push(`${m.you ? 'Your' : `${m.name}'s`} agent is ${a.behind} commits behind: merge soon.`); }
    this.snap = { members, conflicts: [...this.conflicts_.values()], handoffs: [...this.handoffs_.values()], hints }; this.dirty = false; return this.snap;
  }
  /** What this person's agents hold that another's agent is also working on: one line each, for an agent's next turn. */
  digestFor(member: string): string[] {
    const v = this.snapshot(); const mine = new Set(v.members.find((m) => m.id === member)?.agents.map((a) => a.id) ?? []); const out: string[] = [];
    for (const c of v.conflicts) { const other = c.agents.find((a) => !mine.has(a)); const owner = other ? v.members.find((m) => m.agents.some((x) => x.id === other)) : undefined; if (other && [...mine].some((a) => c.agents.includes(a))) out.push(`${owner ? `${owner.name}'s` : "A teammate's"} agent has ${c.paths[0] ?? 'a file you are changing'}.`); }
    return out;
  }
  /** The name of the member whose agent holds a lock on this path, if a teammate's agent has one. */
  holderOf(path: string): { member: string; name: string; agent: string } | undefined {
    const v = this.snapshot(); for (const m of v.members) { if (m.you) continue; for (const a of m.agents) if (a.locks.some((l) => l.path === path)) return { member: m.id, name: m.name, agent: a.id }; } return undefined;
  }
}
