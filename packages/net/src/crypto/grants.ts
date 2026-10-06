/** Key grants: each epoch key sealed (crypto_box_seal) to one device's X25519 key. Only that device can open them. */
import type { DeviceKeyStore } from './device-keys.js';
import type { KeyRing } from './keyring.js';
import { b64, CryptoError, sodium, unb64 } from './sodium.js';

export interface GrantSecret { grants: { kid: string; sealed: string }[] }
/** `kids` is what the recipient may read: with share-history off, pass only the current epoch (and later ones). */
export function sealGrants(ring: KeyRing, kids: string[], toX25519: string, toDevice = ''): { p: { to_device: string; kids: string[] }; secret: GrantSecret } {
  const pk = unb64(toX25519); if (pk.length !== 32) throw new CryptoError('bad_input', 'Not an X25519 public key.');
  const grants = kids.map((kid) => { const key = ring.get(kid); if (!key) throw new CryptoError('unknown_kid', `No key ${kid} to give.`); return { kid, sealed: b64(sodium().crypto_box_seal(key, pk)) }; });
  return { p: { to_device: toDevice, kids }, secret: { grants } };
}
/** The keys this device can open; grants for another device give nothing. */
export function openGrants(device: Pick<DeviceKeyStore, 'unsealWith'>, secret: GrantSecret): { kid: string; key: Uint8Array }[] {
  const out: { kid: string; key: Uint8Array }[] = []; for (const g of secret?.grants ?? []) { if (typeof g?.kid !== 'string' || typeof g?.sealed !== 'string') continue; let sealed: Uint8Array; try { sealed = unb64(g.sealed); } catch { continue; } const key = device.unsealWith(sealed); if (key && key.length === 32) out.push({ kid: g.kid, key }); } return out;
}
/** Which epochs a newcomer gets: everything, or with share-history off the current one only. */
export const grantKids = (ring: KeyRing, shareHistory: boolean) => (shareHistory ? ring.kids() : [ring.current().kid]);
