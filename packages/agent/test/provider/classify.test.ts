import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { classifyClaudeAuth, classifyLogin, effectiveKind } from '../../src/index.js';

describe('classifyLogin', () => {
  it.each([['Logged in using ChatGPT', 0, true, 'subscription'], ['Logged in using an API key - sk-proj-AAAAAAAAAAAAAAAAAAAAAAAA', 0, true, 'api_key'], ['Using Amazon Bedrock', 0, true, 'cloud'], ['Using Google Vertex AI', 0, true, 'cloud'], ['', 1, false, 'unknown'], ['Not logged in', 1, false, 'unknown'], ['Logged in as someone', 0, true, 'unknown'], ['', 0, null, 'unknown'], ['', null, null, 'unknown']])('%j exit %s', (out, code, signed, kind) => { expect(classifyLogin(out, code as number | null)).toEqual({ signedIn: signed, kind }); });
  it('garbled output is kind unknown and counts as a subscription', () => { const r = classifyLogin('\u0000\u0001 garbage ~~~', 0); expect(r.kind).toBe('unknown'); expect(effectiveKind(r.kind)).toBe('subscription'); });
  it('property: any bytes, any exit code: never throws, always a valid classification', () => { fc.assert(fc.property(fc.string({ maxLength: 20_000 }), fc.option(fc.integer({ min: -2, max: 300 })), (s, code) => { const r = classifyLogin(s, code); expect(['subscription', 'api_key', 'cloud', 'unknown']).toContain(r.kind); expect(r.signedIn === null || typeof r.signedIn === 'boolean').toBe(true); }), { numRuns: 300 }); });
  it('only the first 4 KiB is read', () => { expect(classifyLogin('x'.repeat(5000) + 'Logged in using ChatGPT', 0).kind).toBe('unknown'); });
});
describe('classifyClaudeAuth', () => { it('reads only authMethod, and survives anything', () => { expect(classifyClaudeAuth('{"authMethod":"claude.ai","email":"a@b.c"}', 0)).toEqual({ signedIn: true, kind: 'subscription' }); expect(classifyClaudeAuth('nope', 0)).toEqual({ signedIn: null, kind: 'unknown' }); expect(classifyClaudeAuth('{"authMethod":7}', 0).signedIn).toBeNull(); expect(classifyClaudeAuth('{"authMethod":"mystery"}', 0)).toEqual({ signedIn: true, kind: 'unknown' }); fc.assert(fc.property(fc.string(), (s) => { classifyClaudeAuth(s, 0); })); }); });
