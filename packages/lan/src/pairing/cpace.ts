/**
 * CPace (draft-irtf-cfrg-cpace, suite CPACE-RISTR255-SHA512) on libsodium's sumo build, with the CT-LAN §2 parameters pinned.
 * Owns: generator derivation, scalar sampling, verified scalar multiplication (identity and non-canonical encodings rejected), ISK derivation, the CT-LAN channel identifier and key-confirmation MACs.
 * Must not: invent any primitive (everything group-related is libsodium), compare secrets in variable time, or let a secret leave through an error or a log.
 */
import sodium from 'libsodium-wrappers-sumo';

export type Sumo = typeof sodium;
let ready: Promise<void> | undefined; let loaded = false;
/** Load the sumo build once (ristretto255 needs it). Every other function here needs it first. */
export function initCpace(): Promise<void> { ready ??= sodium.ready.then(() => { loaded = true; }); return ready; }
function lib(): Sumo { if (!loaded) throw new Error('Call initCpace() first.'); return sodium; }

export const DSI = new TextEncoder().encode('CPaceRistretto255');
/** SHA-512 input block size (H.s_in_bytes). */
export const S_IN_BYTES = 128;
export const POINT_BYTES = 32;
export const ISK_BYTES = 64;
export const CONFIRM_BYTES = 32;

const utf8 = (s: string) => new TextEncoder().encode(s);
export function concat(...parts: Uint8Array[]): Uint8Array { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }

/** prepend_len: LEB128 length, then the bytes (draft Appendix A.1.1). */
export function prependLen(data: Uint8Array): Uint8Array {
  const len: number[] = []; let n = data.length;
  do { len.push(n < 128 ? n : (n & 0x7f) | 0x80); n = Math.floor(n / 128); } while (n > 0);
  return concat(Uint8Array.from(len), data);
}
export const lvCat = (...parts: Uint8Array[]): Uint8Array => concat(...parts.map(prependLen));

/** generator_string(DSI, PRS, CI, sid, s_in_bytes) with the zero padding that fills the first hash block. */
export function generatorString(dsi: Uint8Array, prs: Uint8Array, ci: Uint8Array, sid: Uint8Array, sInBytes = S_IN_BYTES): Uint8Array {
  const zpad = Math.max(0, sInBytes - 1 - prependLen(prs).length - prependLen(dsi).length);
  return lvCat(dsi, prs, new Uint8Array(zpad), ci, sid);
}

/** G.calculate_generator: ristretto255 element derivation over SHA-512 of the generator string. Returns the encoded generator. */
export function calculateGenerator(prs: Uint8Array, ci: Uint8Array, sid: Uint8Array): Uint8Array {
  const s = lib(); const h = s.crypto_hash_sha512(generatorString(DSI, prs, ci, sid));
  try { return s.crypto_core_ristretto255_from_hash(h); } finally { s.memzero(h); }
}

/** G.sample_scalar: 32 random bytes with the bits above 252 cleared (draft §7.3), never zero. */
export function sampleScalar(random: (n: number) => Uint8Array = (n) => lib().randombytes_buf(n)): Uint8Array {
  for (;;) { const y = random(32).slice(0, 32); if (y.length !== 32) throw new RangeError('rng returned too few bytes'); y[31] = y[31]! & 0x0f; if (y.some((b) => b !== 0)) return y; }
}

/** G.scalar_mult(y, g): our own public share. */
export function scalarMult(y: Uint8Array, g: Uint8Array): Uint8Array { return lib().crypto_scalarmult_ristretto255(y, g); }

/** The identity element's encoding, G.I. */
export const IDENTITY = new Uint8Array(POINT_BYTES);

/** G.scalar_mult_vfy(y, X): null (G.I) when X is not 32 bytes, is the identity, is not a canonical ristretto255 encoding, or the product is the identity. */
export function scalarMultVfy(y: Uint8Array, x: Uint8Array): Uint8Array | null {
  const s = lib();
  if (!(x instanceof Uint8Array) || x.length !== POINT_BYTES || s.memcmp(x, IDENTITY) || !s.crypto_core_ristretto255_is_valid_point(x)) return null;
  try { return s.crypto_scalarmult_ristretto255(y, x); } catch { return null; }
}

/** transcript_ir(Ya, ADa, Yb, ADb) = lv_cat(Ya, ADa) || lv_cat(Yb, ADb). */
export const transcriptIr = (ya: Uint8Array, ada: Uint8Array, yb: Uint8Array, adb: Uint8Array): Uint8Array => concat(lvCat(ya, ada), lvCat(yb, adb));

/** ISK = SHA-512(lv_cat(DSI || "_ISK", sid, K) || transcript). */
export function deriveIsk(sid: Uint8Array, k: Uint8Array, transcript: Uint8Array): Uint8Array {
  return lib().crypto_hash_sha512(concat(lvCat(concat(DSI, utf8('_ISK')), sid, k), transcript));
}

/** CT-LAN §2: CI = lv(host_fp) || lv(guest_fp) || lv(sid), where lv is a 2-byte big-endian length then the UTF-8 bytes. */
export function lanChannelId(hostFp: string, guestFp: string, sid: string): Uint8Array {
  const lv = (s: string) => { const b = utf8(s); if (b.length > 0xffff) throw new RangeError('too long'); return concat(Uint8Array.of(b.length >>> 8, b.length & 0xff), b); };
  return concat(lv(hostFp), lv(guestFp), lv(sid));
}

/** One side of a CPace run. The scalar is wiped as soon as K is computed. */
export interface CpaceParty { share: Uint8Array; finish(peerShare: Uint8Array, transcript: (own: Uint8Array, peer: Uint8Array) => Uint8Array): Uint8Array | null }

/**
 * Start CPace with the CT-LAN parameters: PRS = the pairing code (UTF-8), CI = lanChannelId, sid = the LAN session id, empty AD.
 * `finish` returns ISK, or null when the peer share is invalid (the caller must abort).
 */
export function cpaceStart(o: { code: string; ci: Uint8Array; sid: string; random?: (n: number) => Uint8Array; scalar?: Uint8Array }): CpaceParty {
  const sid = utf8(o.sid); const g = calculateGenerator(utf8(o.code), o.ci, sid); const y = (o.scalar ?? sampleScalar(o.random)).slice();
  const share = scalarMult(y, g); let used = false;
  return {
    share,
    finish(peer, transcript) {
      if (used) return null; used = true;
      const k = scalarMultVfy(y, peer); lib().memzero(y); if (!k) return null;
      try { return deriveIsk(sid, k, transcript(share, peer)); } finally { lib().memzero(k); }
    },
  };
}

/** confirm_X = BLAKE2b-256(key = ISK, data = "centcom.lan.confirm." || X || transcript). */
export function confirmMac(isk: Uint8Array, side: 'host' | 'guest', transcript: Uint8Array): Uint8Array {
  return lib().crypto_generichash(CONFIRM_BYTES, concat(utf8(`centcom.lan.confirm.${side}`), transcript), isk);
}

/** Constant-time equality for MACs and token digests. Lengths are public; a length mismatch is simply false. */
export function ctEqual(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.length > 0 && lib().memcmp(a, b); }

/** Zero a secret buffer in place. */
export const wipe = (b: Uint8Array | undefined): void => { if (b && b.length) lib().memzero(b); };
