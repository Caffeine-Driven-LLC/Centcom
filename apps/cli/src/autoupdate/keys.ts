/** The public keys a release must be signed with. This is the ONLY place that lists them (and they are compiled into the program, never fetched from the
 *  channel that serves the downloads). There are two slots so a key can be rotated without a flag day: ship a release that trusts both, sign with the
 *  new one, then retire the old one. An empty slot trusts nothing, so with no key filled in every update is refused (fail closed).
 *  FILLING THESE IN IS A HUMAN STEP of the release procedure (the private keys never touch this repository). */
import type { ReleaseKeySet } from '@centcom/net';

export interface KeySlot { slot: 'primary' | 'next'; /** `sig_kid` the manifest names. */ id: string; /** base64url, 32 bytes; empty until the release procedure fills it. */ publicKey: string }
export const KEY_SLOTS: readonly [KeySlot, KeySlot] = [
  { slot: 'primary', id: 'rel1', publicKey: '' },
  { slot: 'next', id: 'rel2', publicKey: '' },
];
const valid = (k: KeySlot): boolean => { try { return Buffer.from(k.publicKey, 'base64url').length === 32; } catch { return false; } };
/** The slots that hold a real key. Anything that is not exactly 32 bytes is ignored. */
export function trustedKeys(slots: readonly KeySlot[] = KEY_SLOTS): ReleaseKeySet { return { keys: slots.filter(valid).map((k) => ({ id: k.id, publicKey: k.publicKey })) }; }
