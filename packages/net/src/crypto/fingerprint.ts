/** `fp` = first 12 characters of base32 (RFC 4648) of BLAKE2b-256(D_x || D_s), shown as ABCD-EFGH-IJKL. */
import { sodium, unb64 } from './sodium.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes: Uint8Array): string { let out = ''; let bits = 0; let val = 0; for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
export function fingerprint(x25519: string, ed25519: string): string {
  const x = unb64(x25519); const s = unb64(ed25519); const both = new Uint8Array(x.length + s.length); both.set(x); both.set(s, x.length);
  const f = base32(sodium().crypto_generichash(32, both, null)).slice(0, 12); return `${f.slice(0, 4)}-${f.slice(4, 8)}-${f.slice(8, 12)}`;
}
