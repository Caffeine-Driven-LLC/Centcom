/** Offline invite bundles: the epoch keys sealed to a one-time invite key whose private half travels only in the link fragment `#k=`. */
import type { KeyRing } from './keyring.js';
import { b64, CryptoError, sodium, unb64, utf8 } from './sodium.js';

export function generateInviteSecret(): { secret: Uint8Array; fragment: string } { const sk = sodium().randombytes_buf(32); return { secret: sk, fragment: `#k=${b64(sk)}` }; }
export const inviteSecretFromFragment = (fragment: string): Uint8Array => { const m = /(?:^|#|&)k=([A-Za-z0-9_-]{43})(?:&|$)/.exec(fragment); if (!m) throw new CryptoError('bad_input', 'That link has no key.'); return unb64(m[1]!); };
export function sealInviteBundle(ring: KeyRing, kids: string[], inviteSecret: Uint8Array): string {
  const pk = sodium().crypto_scalarmult_base(inviteSecret); const keys = kids.map((kid) => { const k = ring.get(kid); if (!k) throw new CryptoError('unknown_kid', `No key ${kid}.`); return { kid, key: b64(k) }; });
  return b64(sodium().crypto_box_seal(utf8(JSON.stringify({ v: 1, keys })), pk));
}
export function openInviteBundle(bundle: string, inviteSecret: Uint8Array): { kid: string; key: Uint8Array }[] {
  const s = sodium(); const pk = s.crypto_scalarmult_base(inviteSecret); let pt: Uint8Array; try { pt = s.crypto_box_seal_open(unb64(bundle), pk, inviteSecret); } catch { return []; }
  try { const j = JSON.parse(new TextDecoder().decode(pt)) as { keys: { kid: string; key: string }[] }; return j.keys.map((k) => ({ kid: k.kid, key: unb64(k.key) })).filter((k) => k.key.length === 32); } catch { return []; }
}
