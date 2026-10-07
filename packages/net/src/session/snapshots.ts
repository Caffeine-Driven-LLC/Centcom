/** Snapshots: an encrypted state checkpoint. The blob is `{"v":1,"ct":{alg,kid,n,c}}`; inside is `{"fmt":"centcom.snapshot","v":1,...}`. The host builds and uploads them, anyone with the epoch key reads them. */
import { createHash } from 'node:crypto';
import { decryptPayload, encryptPayload, type FrameHeader } from '../crypto/frame.js';
import type { KeyRing } from '../crypto/keyring.js';
import { MAX_CT_BYTES } from '../crypto/frame.js';
import type { SessionRest, SnapshotDescriptor } from './rest.js';
import { SessionError, type SnapshotDoc } from './types.js';

export const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024; export const SNAPSHOT_EVERY_FRAMES = 500; export const SNAPSHOT_EVERY_MS = 5 * 60_000;
const header = (sid: string, snp: string): FrameHeader => ({ v: 1, t: 'event', id: snp, sid, from_dev: 'snapshot', k: 'snapshot' });
export const sha256Ref = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/** The doc is cut into parts below the per-frame limit and each part is encrypted on its own. */
export function sealSnapshot(sid: string, snp: string, ring: KeyRing, doc: SnapshotDoc): { bytes: Uint8Array; kid: string } {
  const { kid, key } = ring.current(); const text = JSON.stringify(doc); const parts: string[] = []; const step = Math.floor(MAX_CT_BYTES / 2); for (let i = 0; i < text.length; i += step) parts.push(text.slice(i, i + step)); if (parts.length === 0) parts.push('');
  const cts = parts.map((s, i) => encryptPayload({ key, kid, header: { ...header(sid, snp), id: `${snp}:${i}` }, secret: { part: i, of: parts.length, text: s } }));
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, cts })); if (bytes.length > MAX_SNAPSHOT_BYTES) throw new SessionError('too_large', 'The snapshot is larger than the 32 MiB limit.'); return { bytes, kid };
}
export function openSnapshot(sid: string, snp: string, ring: KeyRing, bytes: Uint8Array): SnapshotDoc {
  let blob: { v?: number; cts?: { kid: string; alg: 'xchacha20poly1305'; n: string; c: string }[] }; try { blob = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new SessionError('snapshot_invalid', 'The snapshot could not be read.'); }
  if (blob.v !== 1 || !Array.isArray(blob.cts) || blob.cts.length === 0 || blob.cts.length > 1000) throw new SessionError('snapshot_unsupported', 'This snapshot was made by a newer version of Centcom. Update Centcom to read it.');
  let text = ''; try { blob.cts.forEach((ct, i) => { const s = decryptPayload({ keyFor: (k) => ring.get(k), header: { ...header(sid, snp), id: `${snp}:${i}` }, ct }) as { part: number; of: number; text: string }; if (s.part !== i || s.of !== blob.cts!.length) throw new Error('order'); text += s.text; }); } catch { throw new SessionError('snapshot_invalid', 'The snapshot could not be decrypted (wrong key or damaged).'); }
  let doc: SnapshotDoc; try { doc = JSON.parse(text) as SnapshotDoc; } catch { throw new SessionError('snapshot_invalid', 'The snapshot could not be read.'); }
  if (doc.fmt !== 'centcom.snapshot' || doc.v !== 1) throw new SessionError('snapshot_unsupported', 'This snapshot has a format this version of Centcom does not know. Update Centcom to read it.'); return doc;
}
export interface Transfer { fetch: typeof fetch }
/** GET descriptor, download the blob from the pre-signed address (no bearer token goes there), check size and hash, decrypt. */
export async function fetchSnapshot(rest: SessionRest, sid: string, ring: KeyRing, t: Transfer): Promise<{ doc: SnapshotDoc; seq: number; kid: string } | null> {
  const d: SnapshotDescriptor | null = await rest.snapshot(sid); if (!d?.download_url) return null;
  const res = await t.fetch(d.download_url, { redirect: 'error' }); if (!res.ok) throw new SessionError('snapshot_invalid', `The snapshot could not be downloaded (HTTP ${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer()); if (bytes.length !== d.size || bytes.length > MAX_SNAPSHOT_BYTES) throw new SessionError('snapshot_invalid', 'The snapshot is not the size it was published with.'); if (sha256Ref(bytes) !== d.sha256) throw new SessionError('snapshot_invalid', 'The snapshot does not match its checksum.');
  return { doc: openSnapshot(sid, d.snp, ring, bytes), seq: d.seq, kid: d.kid };
}
/** Host: begin, PUT to the pre-signed address, commit with the position it covers. */
export async function uploadSnapshot(rest: SessionRest, sid: string, ring: KeyRing, doc: SnapshotDoc, t: Transfer): Promise<{ snp: string; seq: number; size: number }> {
  const probe = sealSnapshot(sid, 'snp_probe', ring, doc); const up = await rest.beginSnapshot(sid, { kid: probe.kid, size: probe.bytes.length }); const { bytes, kid } = sealSnapshot(sid, up.snp, ring, doc);
  const res = await t.fetch(up.upload_url, { method: 'PUT', body: bytes as BodyInit, headers: { 'content-type': 'application/octet-stream' }, redirect: 'error' }); if (!res.ok) throw new SessionError('snapshot_invalid', `The snapshot could not be uploaded (HTTP ${res.status}).`);
  await rest.commitSnapshot(sid, up.snp, { seq: doc.seq, sha256: sha256Ref(bytes), size: bytes.length, kid }); return { snp: up.snp, seq: doc.seq, size: bytes.length };
}
