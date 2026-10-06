/** `path_hmac` for file locks: base64url(BLAKE2b-256(key = K_p[e], data = utf8(path))) with K_p[e] = BLAKE2b-256(key = K[e], data = "centcom.pathmac.v1"). */
import type { KeyRing } from './keyring.js';
import { b64, CryptoError, sodium, utf8 } from './sodium.js';

export const pathMacKey = (sessionKey: Uint8Array) => sodium().crypto_generichash(32, utf8('centcom.pathmac.v1'), sessionKey);
/** `path` is normalised: NFC, `/` separators, relative, no leading `./`. */
export function pathHmac(ring: KeyRing, kid: string, path: string): string { const k = ring.get(kid); if (!k) throw new CryptoError('unknown_kid', `No key ${kid}.`); return b64(sodium().crypto_generichash(32, utf8(path.normalize('NFC').replace(/\\/g, '/').replace(/^\.\//, '')), pathMacKey(k))); }
