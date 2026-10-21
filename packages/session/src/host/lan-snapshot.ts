/** The host's snapshot for late joiners (CT-RESUME on the LAN): the state at a seq, sealed under the session key with the net package's snapshot format. The engine stores and serves the bytes and never opens them. */
import { openSnapshot, sealSnapshot, type KeyRing } from '@centcom/net';
import { SNAPSHOT_TRANSCRIPT_MAX, type LanSnapshotDoc } from '../guest/snapshot.js';
import type { GuestState } from '../guest/state.js';
import type { HostSessionEngine } from './engine.js';

/** The id the snapshot's ciphertext is bound to (it is part of the AEAD header), so a snapshot cannot be replayed as another seq. */
export const lanSnapshotId = (seq: number): string => `snp_lan_${seq}`;
export function sealLanSnapshot(sid: string, ring: KeyRing, doc: LanSnapshotDoc): Uint8Array { return sealSnapshot(sid, lanSnapshotId(doc.seq), ring, doc).bytes; }
/** Opens bytes the host named `seq`; throws when the key is missing, the bytes are damaged, or the document says another seq. */
export function openLanSnapshot(sid: string, ring: KeyRing, bytes: Uint8Array, seq: number): LanSnapshotDoc {
  let kid: string | undefined; try { kid = (JSON.parse(new TextDecoder().decode(bytes)) as { cts?: { kid?: string }[] }).cts?.[0]?.kid; } catch { /* openSnapshot says what is wrong */ }
  if (kid && !ring.get(kid)) throw Object.assign(new Error('There is no key for this snapshot yet.'), { code: 'no_key' });
  const doc = openSnapshot(sid, lanSnapshotId(seq), ring, bytes) as unknown as LanSnapshotDoc;
  if (doc.seq !== seq) throw Object.assign(new Error('The snapshot is not for the position it was offered at.'), { code: 'snapshot_invalid' });
  return doc;
}
/** `snapshotBuilder` for the engine: the queue and roster from the engine, the transcript and agents from the host's own view of the conversation. Reads everything before its first await. */
export function lanSnapshotBuilder(o: { sid: string; ring: KeyRing; engine: Pick<HostSessionEngine, 'queue' | 'members'>; view: () => Pick<GuestState, 'transcript' | 'agents'>; hostId?: () => string | undefined; rosterVersion?: () => number }): (i: { seq: number }) => Promise<Uint8Array> {
  return async ({ seq }) => {
    const q = o.engine.queue(); const v = o.view(); const members = o.engine.members().map((m) => ({ id: m.id, name: m.name, slot: m.slot, role: m.role, connected: m.connected })); const host = o.hostId?.();
    const doc: LanSnapshotDoc = { fmt: 'centcom.snapshot', v: 1, seq, queue: { version: q.version, items: q.items as never }, roster: { version: o.rosterVersion?.() ?? 0, members }, transcript: v.transcript.slice(-SNAPSHOT_TRANSCRIPT_MAX), agents: v.agents, ...(host ? { hostId: host } : {}) };
    return sealLanSnapshot(o.sid, o.ring, doc);
  };
}
