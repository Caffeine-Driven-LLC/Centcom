/** Idempotency-Key handling (CT-PAGE "Idempotency"): which requests get a key, what a valid key looks like, and making new ones.
 *  Must not: reuse a key for a different logical request, or make a new key for a retry of the same one. */
import type { HttpOperationSpec } from './spec.js';

/** ULID or UUID per the contract; we accept any URL-safe token of 1..64 characters from callers. */
const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const isValidIdempotencyKey = (k: string): boolean => KEY_RE.test(k);

/** Every POST marked R or A gets a key, made once per logical request. Other methods send one only when the caller supplies it. */
export const wantsIdempotencyKey = (spec: Pick<HttpOperationSpec, 'method' | 'idempotency'>): boolean => spec.method === 'POST' && spec.idempotency !== 'none';

/** A fresh key: the 26-character monotonic ULID from the injected id generator (no prefix). */
export function newIdempotencyKey(ids: { next(prefix: 'req'): string }): string { return ids.next('req').slice(4); }
