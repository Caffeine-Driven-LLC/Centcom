/** PKCE (RFC 7636), S256 only. */
const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
export const b64url = (b: Uint8Array): string => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
/** 64 characters from the unreserved set, drawn without modulo bias. */
export function randomVerifier(rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)), length = 64): string {
  let out = ''; while (out.length < length) for (const b of rand(length * 2)) { if (b < 256 - (256 % UNRESERVED.length) && out.length < length) out += UNRESERVED[b % UNRESERVED.length]; } return out;
}
/** 32 random bytes as 43 base64url characters: 256 bits of state. */
export const randomState = (rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string => b64url(rand(32));
export async function challengeS256(verifier: string, subtle: SubtleCrypto = crypto.subtle): Promise<string> { return b64url(new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(verifier)))); }
/** Compares in time that depends on the length only. */
export function constantTimeEqual(a: string, b: string): boolean { let d = a.length ^ b.length; const n = Math.max(a.length, b.length); for (let i = 0; i < n; i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; }
/** A same-origin path only: anything else becomes `/`. */
export const safeReturnTo = (v: string | undefined | null): string => (typeof v === 'string' && /^\/[A-Za-z0-9/_\-?=&.]*$/.test(v) && !v.startsWith('//') ? v : '/');
