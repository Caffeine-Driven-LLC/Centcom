/** The public keys release signatures are checked against. Two can be valid at once, so a key can be replaced without a flag day.
 *  The production keys are filled in by the signing procedure of the release lane; until then the set is empty and every update is refused (fail closed). */
export interface ReleaseKey { id: string; /** base64url, 32 bytes */ publicKey: string }
export interface ReleaseKeySet { keys: ReleaseKey[] }
export const PRODUCTION_KEYS: ReleaseKeySet = { keys: [] };
