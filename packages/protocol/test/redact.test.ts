import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REDACTED, SECRET_PATTERNS, looksLikeSecret, redact, secretKinds } from '../src/index.js';

const fx = JSON.parse(readFileSync(join(__dirname, '../../../contracts/fixtures/providers/secret-patterns.json'), 'utf8'));

describe('secret redaction follows the contract', () => {
  it('uses exactly the contract patterns', () => { expect(SECRET_PATTERNS.map((p) => p.id).sort()).toEqual(fx.patterns.map((p: { id: string }) => p.id).sort()); });
  it('flags everything the contract says must match', () => { for (const s of fx.must_match) expect(looksLikeSecret(s), s).toBe(true); });
  it('leaves alone everything the contract says must not match', () => { for (const s of fx.must_not_match) expect(looksLikeSecret(s), s).toBe(false); });
  it('removes the secret but keeps the sentence', () => {
    const key = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ'; const out = redact(`failed with ${key} while calling`); expect(out).toBe(`failed with ${REDACTED} while calling`); expect(out).not.toContain('sk-ant');
  });
  it('redacts every occurrence, and a JWT, and a private key block', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'; const o = redact(`a ${jwt} b ${jwt}`); expect(o).toBe(`a ${REDACTED} b ${REDACTED}`);
    expect(redact('x -----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY----- y')).toBe(`x ${REDACTED} y`); expect(secretKinds(jwt)).toContain('openai_oauth_access');
  });
  it('never returns the matched text, only pattern ids', () => { expect(JSON.stringify(secretKinds('AKIAABCDEFGHIJKLMNOP'))).toBe('["aws_access_key"]'); });
  it('is stable when called repeatedly (global regex state does not leak)', () => { const s = 'AKIAABCDEFGHIJKLMNOP'; for (let i = 0; i < 5; i++) { expect(looksLikeSecret(s)).toBe(true); expect(redact(s)).toBe(REDACTED); } });
});
