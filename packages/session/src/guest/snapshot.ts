/** What a host's snapshot holds for a guest, and how a guest takes it in (CT-RESUME). Pure: no crypto here (opening the snapshot is `openLanSnapshot` on the host side of the package). */
import type { GuestState, QueueItemView, RosterEntry, TranscriptEntry } from './state.js';

/** `fmt` and `v` are the contract's; the rest is what a command-post guest needs to start from: the roster, the queue, the transcript so far and the agents. */
export interface LanSnapshotDoc { fmt: 'centcom.snapshot'; v: 1; seq: number; queue: { version: number; items: QueueItemView[] }; roster: { version: number; members: RosterEntry[] }; transcript: TranscriptEntry[]; agents: GuestState['agents']; hostId?: string; [k: string]: unknown }
export const SNAPSHOT_TRANSCRIPT_MAX = 2000;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ROLES = new Set(['host', 'editor', 'viewer']);

/** The state after the snapshot: its roster, queue, transcript and agents replace ours; who we are (`me`) and the warnings stay. Anything malformed in the doc is left out, never thrown. */
export function applyLanSnapshot(s: GuestState, doc: LanSnapshotDoc): GuestState {
  const roster: RosterEntry[] = arr(rec(doc.roster).members).map(rec).filter((m) => typeof m.id === 'string').map((m) => ({ id: String(m.id), name: String(m.name ?? ''), slot: Number(m.slot ?? 0), role: ROLES.has(String(m.role)) ? (m.role as RosterEntry['role']) : 'viewer', connected: m.connected !== false }));
  const me = roster.find((m) => m.id === s.me.member); const items = arr(rec(doc.queue).items).map(rec).filter((i) => typeof i.item === 'string') as unknown as QueueItemView[];
  const agents: GuestState['agents'] = {}; for (const [k, v] of Object.entries(rec(doc.agents))) { const a = rec(v); if (typeof a.state === 'string' && typeof a.owner === 'string') agents[k] = { state: a.state, owner: a.owner }; }
  const transcript = arr(doc.transcript).map(rec).filter((e) => typeof e.kind === 'string' && typeof e.seq === 'number') as unknown as TranscriptEntry[];
  return { ...s, roster, rosterVersion: Number(rec(doc.roster).version ?? 0), queue: { version: Number(rec(doc.queue).version ?? 0), items }, transcript: transcript.slice(-SNAPSHOT_TRANSCRIPT_MAX), agents, lastSeq: Math.max(s.lastSeq, doc.seq), ...(typeof doc.hostId === 'string' ? { hostId: doc.hostId } : {}), me: me ? { ...s.me, slot: me.slot, role: me.role } : s.me, phase: roster.length ? 'live' : s.phase };
}
