/** `node:crypto` for the browser build: only what the session client's snapshot code asks for (a SHA-256 hex digest), done with libsodium, which the session client has already loaded. */
import { sodium } from '@centcom/net-session-sodium';
export function createHash(alg: string): { update(b: Uint8Array): { digest(enc: 'hex'): string } } {
  if (alg !== 'sha256') throw new Error('only sha256 is available here');
  return { update: (b) => ({ digest: () => [...sodium().crypto_hash_sha256(b)].map((x) => x.toString(16).padStart(2, '0')).join('') }) };
}
