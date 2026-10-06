/** libsodium, loaded once. Everything in this folder awaits `initCrypto()` first. */
import sodiumMod from 'libsodium-wrappers';

export type Sodium = typeof sodiumMod;
let ready: Promise<Sodium> | undefined; let loaded = 0;
export const sodiumLoads = () => loaded;
export function initCrypto(): Promise<void> { ready ??= sodiumMod.ready.then(() => { loaded++; return sodiumMod; }); return ready.then(() => undefined); }
/** The loaded library; call `initCrypto()` before. */
export function sodium(): Sodium { if (!ready || loaded === 0) throw new CryptoError('not_ready', 'Call initCrypto() first.'); return sodiumMod; }
export type CryptoErrorCode = 'not_ready' | 'unknown_kid' | 'aead_failed' | 'too_large' | 'bad_input' | 'keychain';
/** Never carries key material or plaintext. */
export class CryptoError extends Error { constructor(readonly code: CryptoErrorCode, message: string) { super(message); this.name = 'CryptoError'; } }
export const b64 = (u: Uint8Array) => sodium().to_base64(u, sodium().base64_variants.URLSAFE_NO_PADDING);
export const unb64 = (s: string): Uint8Array => { try { return sodium().from_base64(s, sodium().base64_variants.URLSAFE_NO_PADDING); } catch { throw new CryptoError('bad_input', 'Not base64url.'); } };
export const utf8 = (s: string) => new TextEncoder().encode(s);
