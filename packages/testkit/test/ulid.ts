const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A fixed valid ULID tail for test ids: 26 Crockford chars, the number n spread into the end. */
export const ulid = (n: number): string => { let s = ''; let x = n; for (let i = 0; i < 6; i++) { s = A[x % 32] + s; x = Math.floor(x / 32); } return '01JTEST'.padEnd(20, '0') + s; };
