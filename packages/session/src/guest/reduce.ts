import { STATE_NAMES } from '@centcom/protocol';
import { SERVER_ONLY } from '../host/authority.js';
import { SERVER, WARNING_RING, type DecodedFrame, type GuestState, type ProtocolWarning, type QueueItemView, type Role, type RosterEntry, type TranscriptEntry } from './state.js';

const KNOWN = new Set<string>(STATE_NAMES as readonly string[]); const HOST_CONTROL = new Set(['control.kick', 'control.mute', 'control.unmute', 'control.role', 'control.transfer_host', 'control.end', 'control.policy', 'control.rotate_request']);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d); const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d); const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const warn = (s: GuestState, w: ProtocolWarning): GuestState => ({ ...s, warnings: [...s.warnings, w].slice(-WARNING_RING) });
const role = (v: unknown): Role => (v === 'host' || v === 'editor' || v === 'viewer' ? v : 'viewer');
const base = (f: DecodedFrame) => ({ seq: num(f.seq), id: str(f.id), from: str(f.from), ts: str(f.ts) });
const push = (s: GuestState, e: TranscriptEntry): GuestState => ({ ...s, transcript: [...s.transcript, e] });
/** Assistant text is the deltas from index 0 up to the first missing index; `gap` says something later is waiting for it. */
const assemble = (parts: Record<number, string>): { text: string; gap: boolean } => { let text = ''; let i = 0; while (parts[i] !== undefined) text += parts[i++]; return { text, gap: Object.keys(parts).some((k) => Number(k) >= i) }; };
const partsOf = new WeakMap<object, Record<number, string>>();

/** Pure and total: folds one sequenced, decoded frame. It never throws, whatever the frame holds. Frames must arrive in order (see GuestIngest). */
export function reduceGuestState(s: GuestState, f: DecodedFrame): GuestState {
  try { return step(s, f); } catch { return warn(s, { seq: f?.seq, kind: String(f?.k), reason: 'reducer_error' }); }
}
function step(s0: GuestState, f: DecodedFrame): GuestState {
  const kind = str(f.k); const seq = num(f.seq); let s: GuestState = seq > s0.lastSeq ? { ...s0, lastSeq: seq } : s0; const p = rec(f.p); const x = rec(f.secret); const b = base(f);
  if (kind.startsWith('control.') && SERVER_ONLY.has(kind) && f.from !== SERVER) return warn(s, { seq, kind, reason: 'control_not_from_server' });
  if (HOST_CONTROL.has(kind) && f.from !== s.hostId && f.from !== SERVER) return warn(s, { seq, kind, reason: 'control_not_from_host' });
  switch (kind) {
    case 'message.user': return push(s, { kind: 'user', ...b, text: str(x.text), ...(typeof x.queue_item === 'string' ? { queueItem: x.queue_item } : {}) });
    case 'message.assistant.delta': {
      const mid = str(x.message_id); if (!mid) return warn(s, { seq, kind, reason: 'missing_message_id' }); const at = s.transcript.findIndex((e) => e.kind === 'assistant' && e.messageId === mid); const prev = at >= 0 ? s.transcript[at]! : undefined; const parts = { ...(prev ? partsOf.get(prev) : undefined), [Math.max(0, num(x.index))]: str(x.delta) }; const a = assemble(parts);
      const entry: TranscriptEntry = { kind: 'assistant', ...(prev ? { seq: prev.seq, id: prev.id, from: prev.from, ts: prev.ts } : b), messageId: mid, agentId: str(x.agent_id), text: a.text, done: prev?.kind === 'assistant' ? prev.done : false, gap: a.gap }; partsOf.set(entry, parts);
      return at >= 0 ? { ...s, transcript: s.transcript.map((e, i) => (i === at ? entry : e)) } : push(s, entry);
    }
    case 'message.assistant.done': { const mid = str(x.message_id); return { ...s, transcript: s.transcript.map((e) => { if (e.kind !== 'assistant' || e.messageId !== mid) return e; const n = { ...e, done: true }; const parts = partsOf.get(e); if (parts) partsOf.set(n, parts); return n; }) }; }
    case 'message.system': return push(s, { kind: 'system', ...b, level: str(x.level, 'info'), text: str(x.text) });
    case 'tool.request': return push(s, { kind: 'tool_request', ...b, agentId: str(x.agent_id), toolId: str(x.tool_id), name: str(x.name), summary: str(x.input_summary), risk: str(x.risk) });
    case 'tool.result': return push(s, { kind: 'tool_result', ...b, agentId: str(x.agent_id), toolId: str(x.tool_id), status: str(x.status), summary: str(x.summary) });
    case 'approval.request': return push(s, { kind: 'approval', ...b, approvalId: str(p.approval_id), agentId: str(p.agent_id), risk: str(p.risk), summary: str(x.summary) });
    case 'approval.decision': return { ...s, transcript: s.transcript.map((e) => (e.kind === 'approval' && e.approvalId === str(p.approval_id) && e.decision === undefined ? { ...e, decision: str(p.decision), decidedBy: b.from } : e)) };
    case 'agent.spawn': return { ...s, agents: { ...s.agents, [str(p.agent_id)]: { state: 'working', owner: str(p.owner, b.from) } } };
    case 'agent.state': { const id = str(p.agent_id); const st = str(p.state); return { ...s, agents: { ...s.agents, [id]: { state: KNOWN.has(st) ? st : 'working', owner: s.agents[id]?.owner ?? b.from } } }; }
    case 'agent.exit': { const id = str(p.agent_id); const cur = s.agents[id]; return cur ? { ...s, agents: { ...s.agents, [id]: { ...cur, state: p.outcome === 'ok' ? 'done' : 'failed' } } } : s; }
    case 'queue.state': { if (f.from !== SERVER) return warn(s, { seq, kind, reason: 'queue_state_not_from_server' }); const v = num(p.version); if (v < s.queue.version) return s; return { ...s, queue: { version: v, items: (Array.isArray(p.items) ? p.items : []).filter((i): i is Record<string, unknown> => !!i && typeof i === 'object').map((i): QueueItemView => ({ item: str(i.item), submitter: str(i.submitter), state: str(i.state), position: typeof i.position === 'number' ? i.position : null, size: num(i.size), kind: str(i.kind), ts: str(i.ts), ...(typeof i.agent_id === 'string' ? { agent_id: i.agent_id } : {}) })) } }; }
    case 'control.roster': { const v = num(p.version); if (v < s.rosterVersion) return s; const members: RosterEntry[] = (Array.isArray(p.members) ? p.members : []).map(rec).filter((m) => typeof m.id === 'string').map((m) => ({ id: str(m.id), name: str(m.name), slot: num(m.slot), role: role(m.role), connected: m.connected !== false })); const mine = members.find((m) => m.id === s.me.member); const host = members.find((m) => m.role === 'host')?.id; return { ...s, roster: members, rosterVersion: v, hostId: host ?? s.hostId, me: mine ? { ...s.me, slot: mine.slot, role: mine.role } : s.me, phase: s.phase === 'connecting' || s.phase === 'reconnecting' ? 'live' : s.phase }; }
    case 'control.member_joined': { const id = str(p.member); const e: RosterEntry = { id, name: str(p.name), slot: num(p.slot), role: role(p.role), connected: true }; return { ...s, roster: [...s.roster.filter((m) => m.id !== id), e].sort((a, c) => a.slot - c.slot) }; }
    case 'control.member_left': return { ...s, roster: s.roster.filter((m) => m.id !== str(p.member)) };
    case 'control.host_changed': return { ...s, hostId: str(p.host), roster: s.roster.map((m) => (m.id === str(p.host) ? { ...m, role: 'host' as const } : m.role === 'host' ? { ...m, role: 'editor' as const } : m)), me: s.me.member === str(p.host) ? { ...s.me, role: 'host' } : s.me.role === 'host' ? { ...s.me, role: 'editor' } : s.me };
    case 'control.role': return str(p.member) === s.me.member ? { ...s, me: { ...s.me, role: role(p.role) }, roster: s.roster.map((m) => (m.id === p.member ? { ...m, role: role(p.role) } : m)) } : { ...s, roster: s.roster.map((m) => (m.id === p.member ? { ...m, role: role(p.role) } : m)) };
    case 'control.mute': return str(p.member) === s.me.member ? { ...s, me: { ...s.me, muted: true } } : s;
    case 'control.unmute': return str(p.member) === s.me.member ? { ...s, me: { ...s.me, muted: false } } : s;
    case 'control.session_state': { const st = str(p.state); return st === 'ended' ? { ...s, phase: 'ended' } : st === 'paused' ? { ...s, phase: 'paused' } : st === 'live' || st === 'active' ? { ...s, phase: s.phase === 'paused' ? 'live' : s.phase } : s; }
    case 'control.kick': return str(p.member) === s.me.member ? { ...s, phase: 'kicked' } : s;
    case 'control.end': return { ...s, phase: 'ended' };
    default: return kind.startsWith('presence.') || kind.startsWith('queue.') || kind.startsWith('control.') || kind === 'reaction' || kind === 'comment.add' || kind === 'key.grant' ? s : push(s, { kind: 'other', ...b, frameKind: kind });
  }
}
