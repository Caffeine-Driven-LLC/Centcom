/** Encrypting, decrypting and signing frame payloads exactly as CT-CRYPTO §2 and §3 say. */
import { canonicalJson } from './canonical-json.js';
import { b64, CryptoError, sodium, unb64, utf8 } from './sodium.js';

export const MAX_CT_BYTES = 192 * 1024;
export interface FrameHeader { v: 1; t: string; id: string; sid: string; from_dev: string; k: string }
export interface Ciphertext { alg: 'xchacha20poly1305'; kid: string; n: string; c: string }
const aadOf = (h: FrameHeader, kid: string) => canonicalJson({ v: h.v, t: h.t, id: h.id, sid: h.sid, from_dev: h.from_dev, k: h.k, kid });
/** Random 24-byte nonce every time (a fixed `nonce` is for known-answer tests only). */
export function encryptPayload(o: { key: Uint8Array; kid: string; header: FrameHeader; secret: object; nonce?: Uint8Array }): Ciphertext {
  const s = sodium(); const n = o.nonce ?? s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const c = s.crypto_aead_xchacha20poly1305_ietf_encrypt(utf8(canonicalJson(o.secret)), aadOf(o.header, o.kid), null, n, o.key);
  const ct: Ciphertext = { alg: 'xchacha20poly1305', kid: o.kid, n: b64(n), c: b64(c) }; if (ct.c.length > MAX_CT_BYTES) throw new CryptoError('too_large', 'That payload is too large for one frame; split it into chunks.'); return ct;
}
export function decryptPayload(o: { keyFor(kid: string): Uint8Array | undefined; header: FrameHeader; ct: Ciphertext }): object {
  if (!o.ct || o.ct.alg !== 'xchacha20poly1305' || typeof o.ct.kid !== 'string') throw new CryptoError('aead_failed', 'Not a ciphertext this client can read.');
  const key = o.keyFor(o.ct.kid); if (!key) throw new CryptoError('unknown_kid', 'No key for that epoch yet.');
  let pt: Uint8Array; try { pt = sodium().crypto_aead_xchacha20poly1305_ietf_decrypt(null, unb64(o.ct.c), aadOf(o.header, o.ct.kid), unb64(o.ct.n), key); } catch { throw new CryptoError('aead_failed', 'The frame failed authentication.'); }
  try { const j = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pt)); if (!j || typeof j !== 'object') throw new Error('x'); return j as object; } catch { throw new CryptoError('aead_failed', 'The frame did not hold a JSON object.'); }
}
const signedInput = (f: { header: FrameHeader; ct: Ciphertext; p?: object }) => canonicalJson({ v: f.header.v, t: f.header.t, id: f.header.id, sid: f.header.sid, from_dev: f.header.from_dev, k: f.header.k, kid: f.ct.kid, n: f.ct.n, c: f.ct.c, ...(f.p !== undefined ? { p: f.p } : {}) });
/** `p` only for hybrid frames. */
export function signFrame(sk: Uint8Array, f: { header: FrameHeader; ct: Ciphertext; p?: object }): string { return b64(sodium().crypto_sign_detached(signedInput(f), sk)); }
/** Constant-time verification (libsodium); never throws. Verify before decrypting. */
export function verifyFrame(pk: Uint8Array, f: { header: FrameHeader; ct: Ciphertext; p?: object }, sig: string): boolean { try { return sodium().crypto_sign_verify_detached(unb64(sig), signedInput(f), pk); } catch { return false; } }
/** Splits a secret payload whose ciphertext would be over the limit into parts `{ chunk: { i, n, group }, part }`. */
export function splitChunks(secret: object, maxBytes = MAX_CT_BYTES): object[] {
  const text = canonicalJson(secret); const room = Math.max(256, Math.floor(((maxBytes * 3) / 4) - 256)); const group = b64(sodium().randombytes_buf(9)); const parts: string[] = [];
  for (let i = 0; i < text.length; ) { let end = Math.min(text.length, i + room); while (end > i && Buffer.byteLength(text.slice(i, end)) > room) end = i + Math.floor((end - i) * 0.9); if (end < text.length && /[\ud800-\udbff]/.test(text[end - 1]!)) end--; parts.push(text.slice(i, end)); i = end; }
  return parts.map((part, i) => ({ chunk: { i, n: parts.length, group }, part }));
}
export function joinChunks(parts: object[]): object {
  const ps = parts as { chunk?: { i: number; n: number; group: string }; part?: string }[]; if (!ps.length) throw new CryptoError('bad_input', 'No chunks.'); const g = ps[0]!.chunk?.group; const n = ps[0]!.chunk?.n;
  if (ps.some((p) => !p.chunk || p.chunk.group !== g || p.chunk.n !== n || typeof p.part !== 'string') || ps.length !== n) throw new CryptoError('bad_input', 'Chunks are missing or from different groups.');
  const sorted = [...ps].sort((a, b) => a.chunk!.i - b.chunk!.i); if (sorted.some((p, i) => p.chunk!.i !== i)) throw new CryptoError('bad_input', 'Chunk numbers have gaps.'); return JSON.parse(sorted.map((p) => p.part).join('')) as object;
}
