import { describe, expect, it } from 'vitest';
import { b64url, challengeS256, constantTimeEqual, randomState, randomVerifier, safeReturnTo } from '../../src/auth/pkce.js';

describe('PKCE (acceptance 1)', () => {
  it('matches the RFC 7636 appendix B vector', async () => { expect(await challengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'); });
  it('the verifier is 64 unreserved characters, different every time; the challenge is 43 characters of base64url', async () => {
    const a = randomVerifier(); const b = randomVerifier(); expect(a).toMatch(/^[A-Za-z0-9\-._~]{64}$/); expect(a).not.toBe(b); const c = await challengeS256(a); expect(c).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(c).not.toBe(a);
  });
  it('the state carries 256 bits', () => { expect(randomState()).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(randomState()).not.toBe(randomState()); expect(b64url(new Uint8Array([251, 255, 254]))).toBe('-__-'); });
  it('constant-time compare and return paths', () => { expect(constantTimeEqual('abc', 'abc')).toBe(true); expect(constantTimeEqual('abc', 'abd')).toBe(false); expect(constantTimeEqual('abc', 'abcd')).toBe(false); expect(constantTimeEqual('', '')).toBe(true);
    for (const ok of ['/', '/sessions/ses_1?tab=a', '/a/b-c_d.e']) expect(safeReturnTo(ok)).toBe(ok); for (const bad of ['//evil.com', 'https://evil.com', '/a b', '/a#x', 'javascript:alert(1)', '', undefined, null, '/\\evil']) expect(safeReturnTo(bad as never)).toBe('/'); });
});
