/** Checks a downloaded file: its SHA-256 equals the manifest's (compared in constant time), and the Ed25519 signature over the 32 digest bytes verifies against a trusted key. */
import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { initCrypto, sodium } from '../crypto/sodium.js';
import { HashMismatchError, SignatureError } from './errors.js';
import type { ReleaseKeySet } from './keys.js';

export const sha256File = (path: string): Promise<Buffer> => new Promise((res, rej) => { const h = createHash('sha256'); createReadStream(path).on('error', rej).on('data', (c) => h.update(c)).on('end', () => res(h.digest())); });
const unb64 = (s: string): Uint8Array | undefined => { try { const b = Buffer.from(s, 'base64url'); return b.length ? new Uint8Array(b) : undefined; } catch { return undefined; } };
export async function verifyArtifact(path: string, a: { sha256: string; sig: string; sig_kid?: string }, keys: ReleaseKeySet): Promise<void> {
  const digest = await sha256File(path); const want = Buffer.from(a.sha256, 'hex'); if (want.length !== 32 || !timingSafeEqual(digest, want)) throw new HashMismatchError();
  await initCrypto(); const s = sodium(); const sig = unb64(a.sig); if (!sig || sig.length !== 64) throw new SignatureError();
  const candidates = keys.keys.filter((k) => !a.sig_kid || k.id === a.sig_kid); if (!candidates.length) throw new SignatureError();
  for (const k of candidates) { const pk = unb64(k.publicKey); if (pk?.length === 32 && s.crypto_sign_verify_detached(sig, new Uint8Array(digest), pk)) return; }
  throw new SignatureError();
}
