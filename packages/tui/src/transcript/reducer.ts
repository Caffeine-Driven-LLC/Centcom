/** Session events (what other people's agents and messages look like on the wire, already decrypted) into transcript items. Sequenced by the relay's `seq`; assistant deltas are put in order and de-duplicated. */
import type { Item } from '../state/model.js';
import { sanitizeForTerminal as clean } from './sanitize.js';

export interface SessionEventInput { kind: string; agent_id?: string; from?: string; at: string; seq?: number; data: unknown }
export interface Member { id: string; name: string; slot: number }
interface Pending { parts: Map<number, string>; next: number; gapSince?: number }
export interface TranscriptState { items: Item[]; lastSeq: number; deltas: Map<string, Pending>; members: Map<string, Member> }
export const REORDER_MAX = 64; export const GAP_MS = 2000;
export const emptyTranscript = (members: Member[] = []): TranscriptState => ({ items: [], lastSeq: 0, deltas: new Map(), members: new Map(members.map((m) => [m.id, m])) });
const S = (v: unknown) => (typeof v === 'string' ? clean(v) : '');
let n = 0; const nid = (p: string) => `${p}${++n}`;

function flushText(st: TranscriptState, mid: string, agentId: string, now: number, final = false): TranscriptState {
  const p = st.deltas.get(mid)!; let text = ''; let i = p.next; while (p.parts.has(i)) { text += p.parts.get(i)!; p.parts.delete(i); i++; } p.next = i;
  if (p.parts.size && !text) { p.gapSince ??= now; if (now - p.gapSince > GAP_MS || p.parts.size > REORDER_MAX) { const keys = [...p.parts.keys()].sort((a, b) => a - b); text = '…' + keys.map((k) => p.parts.get(k)!).join(''); p.next = keys.at(-1)! + 1; p.parts.clear(); p.gapSince = undefined; } } else p.gapSince = undefined;
  if (!text && !final) return st;
  const ix = st.items.findIndex((x) => x.kind === 'assistant' && x.messageId === mid); const items = [...st.items];
  if (ix < 0) items.push({ kind: 'assistant', id: nid('ra'), messageId: mid, agentId, text, done: final }); else { const cur = items[ix] as Extract<Item, { kind: 'assistant' }>; items[ix] = { ...cur, text: cur.text + text, done: final || cur.done }; }
  return { ...st, items };
}
/** Unknown kinds and malformed events are ignored, never thrown. */
export function reduceTranscript(st: TranscriptState, e: SessionEventInput, now = Date.now()): TranscriptState {
  try {
    if (!e || typeof e.kind !== 'string') return st; if (typeof e.seq === 'number') { if (e.seq <= st.lastSeq) return st; st = { ...st, lastSeq: e.seq }; }
    const d = (e.data ?? {}) as Record<string, unknown>; const agent = S(e.agent_id ?? d.agent_id);
    switch (e.kind) {
      case 'message.user': { const m = st.members.get(e.from ?? ''); return { ...st, items: [...st.items, { kind: 'user', id: nid('ru'), text: S(d.text), ts: Date.parse(e.at) || now, ...(m ? { member: { name: m.name, slot: m.slot } } : {}) } as Item] }; }
      case 'message.assistant.delta': {
        const mid = S(d.message_id); const idx = Number(d.index); if (!mid || !Number.isInteger(idx) || idx < 0) return st;
        const p = st.deltas.get(mid) ?? { parts: new Map<number, string>(), next: 0 }; if (idx < p.next || p.parts.has(idx)) return st; // a delta seen before
        p.parts.set(idx, S(d.delta)); st.deltas.set(mid, p); return flushText(st, mid, agent, now);
      }
      case 'message.assistant.done': { const mid = S(d.message_id); if (!mid) return st; if (!st.deltas.has(mid)) st.deltas.set(mid, { parts: new Map(), next: 0 }); const r = flushText(st, mid, agent, now, true); const ix = r.items.findIndex((x) => x.kind === 'assistant' && x.messageId === mid); if (ix >= 0 && typeof d.text === 'string' && d.text) { const items = [...r.items]; items[ix] = { ...(items[ix] as Extract<Item, { kind: 'assistant' }>), text: S(d.text), done: true }; return { ...r, items }; } return r; }
      case 'message.system': return { ...st, items: [...st.items, { kind: 'notice', id: nid('rn'), level: 'info', text: S(d.text) }] };
      case 'tool.request': return { ...st, items: [...st.items, { kind: 'tool', id: nid('rt'), toolId: S(d.tool_id), agentId: agent, name: S(d.name) || 'tool', summary: S(d.summary ?? d.input_summary), risk: d.risk === 'high' || d.risk === 'low' ? d.risk : 'medium', status: 'running', startedAt: Date.parse(e.at) || now, ...(typeof d.path === 'string' ? { path: S(d.path) } : {}), ...(typeof d.command === 'string' ? { command: S(d.command) } : {}) } as Item] };
      case 'tool.result': { const tid = S(d.tool_id); const status = d.status === 'error' || d.status === 'denied' || d.status === 'canceled' ? d.status : 'ok'; return { ...st, items: st.items.map((x) => (x.kind === 'tool' && x.toolId === tid ? { ...x, status, result: S(d.summary) || (status === 'ok' ? 'done' : String(status)) } : x)) }; }
      case 'approval.request': return { ...st, items: [...st.items, { kind: 'notice', id: nid('rn'), level: 'warn', text: `Approval asked: ${S(d.summary) || S(d.tool)}` }] };
      case 'approval.decision': return { ...st, items: [...st.items, { kind: 'notice', id: nid('rn'), level: d.decision === 'approve' ? 'ok' : 'info', text: d.decision === 'approve' ? 'Approved' : 'Denied' }] };
      case 'agent.exit': return { ...st, items: [...st.items, { kind: 'notice', id: nid('rn'), level: d.outcome === 'error' ? 'error' : 'info', text: `Agent ${d.outcome === 'ok' ? 'finished' : d.outcome === 'canceled' ? 'stopped' : 'ended with an error'}` }] };
      default: return st;
    }
  } catch { return st; }
}
